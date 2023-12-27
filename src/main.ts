import {
  PLAPI,
  PLExtAPI,
  PLExtension,
  PLMainAPI,
  PaperEntity,
} from "paperlib-api";

import { MetadataScrapeService } from "@/services/metadata-scrape-service";

interface IScraperPreference {
  type: "boolean";
  name: string;
  description: string;
  value: boolean;
}

class PaperlibMetadataScrapeExtension extends PLExtension {
  disposeCallbacks: (() => void)[];

  private readonly _metadataScrapeService: MetadataScrapeService;

  constructor() {
    super({
      id: "@future-scholars/paperlib-metadata-scrape-extension",
      defaultPreference: {
        presetting: {
          type: "options",
          name: "Presetting",
          description: "Scraper bundle presetting.",
          options: {
            general: "General",
            cs: "Computer Science",
            es: "Earth Science",
          },
          value: "general",
          order: 0,
        },
        "scraper-arxiv": {
          type: "boolean",
          name: "Arxiv",
          description: "arxiv.org",
          value: true,
          order: 1,
        },
        "scraper-chemrxiv": {
          type: "boolean",
          name: "ChemRxiv",
          description: "chemrxiv.org",
          value: false,
          order: 1,
        },
        "scraper-crossref": {
          type: "boolean",
          name: "Crossref",
          description: "crossref.org",
          value: true,
          order: 1,
        },
        "scraper-dblp": {
          type: "boolean",
          name: "DBLP",
          description: "dblp.org - Computer Science Bibliography",
          value: true,
          order: 1,
        },
        "scraper-doi": {
          type: "boolean",
          name: "DOI",
          description: "Digital Object Identifier (DOI)",
          value: true,
          order: 1,
        },
        "scraper-openreview": {
          type: "boolean",
          name: "OpenReview",
          description: "openreview.net",
          value: true,
          order: 1,
        },
        "scraper-pwc": {
          type: "boolean",
          name: "Paper with Code",
          description: "paperwithcode.com",
          value: true,
          order: 1,
        },
        "scraper-pubmed": {
          type: "boolean",
          name: "PubMed",
          description: "pubmed.ncbi.nlm.nih.gov",
          value: false,
          order: 1,
        },
        "scraper-semanticscholar": {
          type: "boolean",
          name: "Semantic Scholar",
          description: "semanticscholar.org",
          value: true,
          order: 1,
        },
        "scraper-spie": {
          type: "boolean",
          name: "SPIE",
          description: "spiedigitallibrary.org",
          value: false,
          order: 1,
        },
        "scraper-ieee": {
          type: "boolean",
          name: "IEEE xplore",
          description: "IEEE Xplore Digital Library",
          value: false,
          order: 2,
        },
        "ieee-scrapers-api-key": {
          type: "string",
          name: "IEEE API Key",
          description: "IEEE API Key, get one from https://developer.ieee.org/",
          value: "",
          order: 2,
        },
      },
    });

    this._metadataScrapeService = new MetadataScrapeService();

    this.disposeCallbacks = [];
  }

  private _registerContextMenu() {
    const enabledScrapers: { [id: string]: string } = {};

    const scraperPref: Record<string, IScraperPreference> =
      PLExtAPI.extensionPreferenceService.getAll(this.id);

    for (const [id, pref] of Object.entries(scraperPref)) {
      if (id.startsWith("scraper-") && pref.value) {
        enabledScrapers[id] = pref.name;
      }
    }

    PLMainAPI.contextMenuService.registerScraperExtension(
      this.id,
      enabledScrapers,
    );
  }

  async initialize() {
    await PLExtAPI.extensionPreferenceService.register(
      this.id,
      this.defaultPreference,
    );

    this.disposeCallbacks.push(
      PLExtAPI.extensionPreferenceService.onChanged(
        this.id,
        "presetting",
        (newValue) => {
          // TODO: implement here
          console.log("presetting changed", newValue);
        },
      ),
    );

    this.disposeCallbacks.push(
      PLAPI.hookService.hookModify("scrapeMetadata", this.id, "scrapeMetadata"),
    );

    this._registerContextMenu();
  }

  async dispose() {
    for (const disposeCallback of this.disposeCallbacks) {
      disposeCallback();
    }
    PLExtAPI.extensionPreferenceService.unregister(this.id);
    PLMainAPI.contextMenuService.unregisterScraperExtension(this.id);
  }

  async scrapeMetadata(
    paperEntityDrafts: PaperEntity[],
    specificScrapers: string[],
    force: boolean,
  ) {
    console.time("scrapeMetadata");
    if (paperEntityDrafts.length === 0) {
      console.timeEnd("scrapeMetadata");

      return [paperEntityDrafts, specificScrapers, force];
    }

    // Get enabled scrapers
    let scrapers: string[] = [];
    if (specificScrapers.length > 0) {
      scrapers = specificScrapers.filter((scraper) =>
        scraper.startsWith(this.id),
      );
      if (scrapers.length === 0) {
        console.timeEnd("scrapeMetadata");

        return [paperEntityDrafts, specificScrapers, force];
      } else {
        scrapers = scrapers.map((scraper) =>
          scraper.replace(`${this.id}-`, ""),
        );
      }
    } else {
      const scraperPref: Record<string, IScraperPreference> =
        PLExtAPI.extensionPreferenceService.getAll(this.id);

      for (const [id, pref] of Object.entries(scraperPref)) {
        if (pref.value && id.startsWith("scraper-")) {
          scrapers.push(id);
        }
      }
    }
    scrapers = scrapers.map((scraper) => scraper.replace("scraper-", ""));

    if (scrapers.includes("chemrxiv")) {
      scrapers.push("chemrxivprecise");
      scrapers.push("chemrxivfuzzy");
      scrapers = scrapers.filter((scraper) => scraper !== "chemrxiv");
    }

    // TODO: Add scraper specific params
    const scrapedPaperEntityDrafts = await this._metadataScrapeService.scrape(
      paperEntityDrafts.map((paperEntityDraft) => {
        return new PaperEntity(paperEntityDraft);
      }),
      specificScrapers,
      force,
    );

    console.timeEnd("scrapeMetadata");

    return [scrapedPaperEntityDrafts, specificScrapers, force];
  }
}

async function initialize() {
  const extension = new PaperlibMetadataScrapeExtension();
  await extension.initialize();

  return extension;
}

export { initialize };
