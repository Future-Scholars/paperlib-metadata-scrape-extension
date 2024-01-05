import { PLAPI } from "paperlib-api/api";
import { PaperEntity } from "paperlib-api/model";
import { chunkRun, metadataUtils } from "paperlib-api/utils";
import Queue from "queue";

import { ArXivScraper } from "@/scrapers/arxiv";
import {
  ChemRxivFuzzyScraper,
  ChemRxivPreciseScraper,
} from "@/scrapers/chemrxiv";
import { CrossRefScraper } from "@/scrapers/crossref";
import { DBLPScraper } from "@/scrapers/dblp";
import { DOIScraper } from "@/scrapers/doi";
import { IEEEScraper } from "@/scrapers/ieee";
import { OpenreviewScraper } from "@/scrapers/openreview";
import { PaperlibMetadataServiceScraper } from "@/scrapers/paperlib-metadata";
import { PwCScraper } from "@/scrapers/paperwithcode";
import { PubMedScraper } from "@/scrapers/pubmed";
import { Scraper } from "@/scrapers/scraper";
import { SemanticScholarScraper } from "@/scrapers/semanticscholar";

const PRECISE_SCRAPERS = new Map([
  ["doi", { breakable: true, mustwait: true }],
  ["arxiv", { breakable: false, mustwait: false }],
  ["chemrxivprecise", { breakable: false, mustwait: false }],
]); // name: {breakable, mustwait}

const FUZZY_SCRAPERS = new Map([
  ["dblp", { breakable: true, mustwait: true }],
  ["semanticscholar", { breakable: true, mustwait: false }],
  ["crossref", { breakable: true, mustwait: false }],
  ["openreview", { breakable: false, mustwait: false }],
  ["chemrxivfuzzy", { breakable: false, mustwait: false }],
  ["pubmed", { breakable: true, mustwait: false }],
]);

// Scrapers that should be run after all scrapers
const ADDITIONAL_SCRAPERS = new Map([
  ["pwc", { breakable: false, mustwait: true }],
]);

const PAPERLIB_METADATA_SERVICE_SCRAPERS = new Map([
  ...PRECISE_SCRAPERS,
  ...FUZZY_SCRAPERS,
  ...ADDITIONAL_SCRAPERS,
]);

const CLIENTSIDE_SCRAPERS = new Map([
  ["ieee", { breakable: true, mustwait: false }],
]);

const SCRAPER_OBJS = new Map<string, typeof Scraper>([
  ["doi", DOIScraper],
  ["arxiv", ArXivScraper],
  ["dblp", DBLPScraper],
  ["semanticscholar", SemanticScholarScraper],
  ["crossref", CrossRefScraper],
  ["openreview", OpenreviewScraper],
  ["pwc", PwCScraper],
  ["chemrxivprecise", ChemRxivPreciseScraper],
  ["chemrxivfuzzy", ChemRxivFuzzyScraper],
  ["ieee", IEEEScraper],
  ["pubmed", PubMedScraper],
]);

// ------------------------------- (PaperlibMetadataService first)
// | PaperlibMetadataServiceScraper  (default)
// -------------------------------
//    v
//    v
// ------------------------------- (Local Scrapers, if PaperlibMetadataService failed)
// |
// | PreciseScrapers (by some ids, e.g. DOI, arXiv, ChemRxiv)
// |  v
// | FuzzyScrapers and ClientsideScrapers (by title, e.g. DBLP, Semantic Scholar)
// |  v
// | AdditionalScrapers (e.g., paper with code)
// |
// -------------------------------
//    v
//    v
// ------------------------------- (Clientside Scrapers, if PaperlibMetadataService cannot find the paper)
// | ClientsideScrapers (by title, e.g. Google Scholar, IEEE)
// |  v
// | AdditionalScrapers (e.g., paper with code)
// -------------------------------

/**
 * EntryScrapeService transforms a data source, such as a local file, web page, etc., into a PaperEntity.*/
export class MetadataScrapeService {
  constructor() {}

  async scrape(
    paperEntityDrafts: PaperEntity[],
    scrapers: string[],
    force: boolean = false,
  ): Promise<PaperEntity[]> {
    if (!force) {
      paperEntityDrafts = paperEntityDrafts.filter(
        (paperEntityDraft) =>
          !metadataUtils.isMetadataCompleted(paperEntityDraft),
      );
    }

    const {
      results: _scrapedPaperEntityDrafts,
      errors: metadataScraperErrors,
    } = await chunkRun<PaperEntity, PaperEntity, PaperEntity>(
      paperEntityDrafts,
      async (paperEntityDraft): Promise<PaperEntity> => {
        const paperEntityDraftAndErrors = await this.scrapePMS(
          paperEntityDraft,
          scrapers,
        );
        paperEntityDraft = paperEntityDraftAndErrors.paperEntityDraft;

        if (paperEntityDraftAndErrors.errors.length > 0) {
          PLAPI.logService.error(
            "Paperlib metadata service error.",
            paperEntityDraftAndErrors.errors[0] as Error,
            true,
            "MetadataScrapeExt",
          );
        }

        if (!metadataUtils.isMetadataCompleted(paperEntityDraft)) {
          // 2.2 Run some force-clientside scrapers
          const paperEntityDraftAndErrors = await this.scrapeClientside(
            paperEntityDraft,
            scrapers,
          );
          paperEntityDraft = paperEntityDraftAndErrors.paperEntityDraft;

          if (paperEntityDraftAndErrors.errors.length > 0) {
            for (const error of paperEntityDraftAndErrors.errors) {
              PLAPI.logService.error(
                "Clientside metadata service failed.",
                `${error.message} \n ${error.stack}`,
                true,
                "MetadataScrapeExt",
              );
            }
          }
        }

        return paperEntityDraft;
      },
      async (paperEntityDraft): Promise<PaperEntity> => {
        return paperEntityDraft;
      },
    );

    for (const error of metadataScraperErrors) {
      PLAPI.logService.error(
        "Failed to scrape metadata.",
        `${error.message} \n ${error.stack}`,
        true,
        "MetadataScrapeExt",
      );
    }
    let scrapedPaperEntityDrafts = _scrapedPaperEntityDrafts.flat();

    return scrapedPaperEntityDrafts;
  }

  /**
   * Scrape from the default Paperlib Metadata Service(PMS)
   * @param paperEntityDraft - paper entity to be scraped
   * @param scrapers - list of scraper names to be used
   * @param force - whether to force scraping
   * @returns scraped paper entity with fullfilled metadata, and errors
   */
  async scrapePMS(
    paperEntityDraft: PaperEntity,
    scrapers: string[] = [],
  ): Promise<{ paperEntityDraft: PaperEntity; errors: Error[] }> {
    const enabeledPMSScraperList = scrapers.filter((name) =>
      Array.from(PAPERLIB_METADATA_SERVICE_SCRAPERS.keys()).includes(name),
    );
    const errors: Error[] = [];
    try {
      paperEntityDraft = await PaperlibMetadataServiceScraper.scrape(
        paperEntityDraft,
        ["cache"].concat(enabeledPMSScraperList),
      );
    } catch (e) {
      errors.push(e as Error);

      const paperEntityDraftAndErrors = await this.scrapePMSLocalBackup(
        paperEntityDraft,
        scrapers,
      );

      paperEntityDraft = paperEntityDraftAndErrors.paperEntityDraft;

      errors.push(...paperEntityDraftAndErrors.errors);
    }
    return { paperEntityDraft, errors };
  }

  /**
   * Scrape from local scrapers as backup if Paperlib Metadata Service(PMS) failed.
   * @param paperEntityDraft - paper entity to be scraped
   * @param scrapers - list of scraper names to be used
   * @param force - whether to force scraping
   * @returns scraped paper entity with fullfilled metadata, and errors
   */
  async scrapePMSLocalBackup(
    paperEntityDraft: PaperEntity,
    scrapers: string[] = [],
  ): Promise<{ paperEntityDraft: PaperEntity; errors: Error[] }> {
    const errors: Error[] = [];
    const draftAndErrorsPrecise = await this._scrapePrecise(
      paperEntityDraft,
      scrapers,
    );
    paperEntityDraft = draftAndErrorsPrecise.paperEntityDraft;
    errors.push(...draftAndErrorsPrecise.errors);

    if (!metadataUtils.isMetadataCompleted(paperEntityDraft)) {
      const draftAndErrorsFuzzy = await this._scrapeFuzzy(
        paperEntityDraft,
        scrapers,
      );
      paperEntityDraft = draftAndErrorsFuzzy.paperEntityDraft;
      errors.push(...draftAndErrorsFuzzy.errors);
    }
    const draftAndErrorsAdditional = await this._scrapeAdditional(
      paperEntityDraft,
      scrapers,
    );
    paperEntityDraft = draftAndErrorsAdditional.paperEntityDraft;
    errors.push(...draftAndErrorsAdditional.errors);

    return { paperEntityDraft, errors };
  }

  /**
   * Scrape from some force-clientside scrapers, such as Google Scholars, if PMS and local backups cannot scrape the metadata.
   * @param paperEntityDraft - paper entity to be scraped
   * @param scrapers - list of scraper names to be used
   * @param force - whether to force scraping
   * @returns scraped paper entity with fullfilled metadata, and errors
   */
  async scrapeClientside(
    paperEntityDraft: PaperEntity,
    scrapers: string[] = [],
  ): Promise<{ paperEntityDraft: PaperEntity; errors: Error[] }> {
    if (metadataUtils.isMetadataCompleted(paperEntityDraft)) {
      return {
        paperEntityDraft,
        errors: [],
      };
    }
    const paperEntityDraftAndErrors = await this._scrapeClientside(
      paperEntityDraft,
      scrapers,
    );

    const paperEntityDraftAndErrorsAdditional = await this._scrapeAdditional(
      paperEntityDraftAndErrors.paperEntityDraft,
      scrapers,
    );

    return {
      paperEntityDraft: paperEntityDraftAndErrorsAdditional.paperEntityDraft,
      errors: [
        ...paperEntityDraftAndErrors.errors,
        ...paperEntityDraftAndErrorsAdditional.errors,
      ],
    };
  }

  async _scrapePrecise(
    paperEntityDraft: PaperEntity,
    scrapers: string[],
  ): Promise<{ paperEntityDraft: PaperEntity; errors: Error[] }> {
    const enabledScrapers = Array.from(PRECISE_SCRAPERS.keys()).filter(
      (scraper) => scrapers.includes(scraper),
    );

    return await this._scrapePipeline(
      paperEntityDraft,
      enabledScrapers,
      PRECISE_SCRAPERS,
      0,
      0,
    );
  }

  async _scrapeFuzzy(
    paperEntityDraft: PaperEntity,
    scrapers: string[],
  ): Promise<{ paperEntityDraft: PaperEntity; errors: Error[] }> {
    const enabledScrapers = Array.from(FUZZY_SCRAPERS.keys()).filter(
      (scraper) => scrapers.includes(scraper),
    );

    return await this._scrapePipeline(
      paperEntityDraft,
      enabledScrapers,
      FUZZY_SCRAPERS,
      500,
      200,
    );
  }

  async _scrapeAdditional(
    paperEntityDraft: PaperEntity,
    scrapers: string[],
  ): Promise<{ paperEntityDraft: PaperEntity; errors: Error[] }> {
    const enabledScrapers = Array.from(ADDITIONAL_SCRAPERS.keys()).filter(
      (scraper) => scrapers.includes(scraper),
    );
    return this._scrapePipeline(
      paperEntityDraft,
      enabledScrapers,
      ADDITIONAL_SCRAPERS,
      0,
      400,
    );
  }

  async _scrapeClientside(
    paperEntityDraft: PaperEntity,
    scrapers: string[],
  ): Promise<{ paperEntityDraft: PaperEntity; errors: Error[] }> {
    const enabledScrapers = Array.from(CLIENTSIDE_SCRAPERS.keys()).filter(
      (scraper) => scrapers.includes(scraper),
    );

    return this._scrapePipeline(
      paperEntityDraft,
      enabledScrapers,
      ADDITIONAL_SCRAPERS,
      0,
      300,
    );
  }

  async _scrapePipeline(
    paperEntityDraft: PaperEntity,
    enabledScrapers: string[],
    scraperProps: Map<string, { breakable: boolean; mustwait: boolean }>,
    gapTime = 0,
    priority_offset = 0,
  ): Promise<{ paperEntityDraft: PaperEntity; errors: Error[] }> {
    const errors: Error[] = [];
    return new Promise(async function (resolve, reject) {
      const q = Queue();
      q.timeout = 20000;

      let mergePriorityLevel = {
        title: 999,
        minifiedTitle: 999,
        authors: 999,
        publication: 999,
        pubTime: 999,
        pubType: 999,
        doi: 999,
        arxiv: 999,
        pages: 999,
        volume: 999,
        number: 999,
        publisher: 999,
        codes: 999,
      } as { [key: string]: number };
      const originPaperEntityDraft = new PaperEntity(paperEntityDraft);

      let mustwaitN = enabledScrapers.filter(
        (scraper) => scraperProps.get(scraper)?.mustwait,
      ).length;

      for (const scraper of enabledScrapers) {
        q.push(function () {
          return new Promise(async function (resolve, reject) {
            const scraperObj = SCRAPER_OBJS.get(scraper) as typeof Scraper;
            const scraperIndex = enabledScrapers.indexOf(scraper);

            await new Promise((resolve) =>
              setTimeout(resolve, gapTime * scraperIndex),
            );

            let scrapedPaperEntity: PaperEntity;
            try {
              const toBeScrapedPaperEntity = new PaperEntity(paperEntityDraft);
              scrapedPaperEntity = await scraperObj.scrape(
                toBeScrapedPaperEntity,
              );
            } catch (error) {
              errors.push(error as Error);
              scrapedPaperEntity = paperEntityDraft;
            }
            resolve({
              scrapedPaperEntity,
              scraper,
              scraperIndex,
            });
          });
        });
      }

      q.on(
        "success",
        function (
          result: {
            scrapedPaperEntity: PaperEntity;
            scraper: string;
            scraperIndex: number;
          },
          job,
        ) {
          const scrapedPaperEntity = result.scrapedPaperEntity;
          const { breakable, mustwait } = scraperProps.get(result.scraper)!;
          const scraperIndex = result.scraperIndex;
          const merged = metadataUtils.mergeMetadata(
            originPaperEntityDraft,
            paperEntityDraft,
            scrapedPaperEntity,
            mergePriorityLevel,
            scraperIndex + priority_offset,
          );
          paperEntityDraft = merged.paperEntityDraft;
          mergePriorityLevel = merged.mergePriorityLevel;

          if (mustwait) {
            mustwaitN -= 1;
          }

          if (
            breakable &&
            metadataUtils.isMetadataCompleted(paperEntityDraft) &&
            mustwaitN === 0
          ) {
            q.end();
          }
        },
      );

      q.on("end", function (err) {
        if (err) {
          errors.push(err);
        }
        resolve({
          paperEntityDraft,
          errors,
        });
      });

      q.on("timeout", function (next, job) {
        next();
      });

      q.start(function (err) {
        if (err) {
          errors.push(err);
        }
        resolve({
          paperEntityDraft,
          errors,
        });
      });
    });
  }
}
