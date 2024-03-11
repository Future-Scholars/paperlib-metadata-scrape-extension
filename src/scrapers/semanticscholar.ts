import { PLExtAPI } from "paperlib-api/api";
import { PaperEntity } from "paperlib-api/model";
import { stringUtils } from "paperlib-api/utils";

import { DOIScraper } from "./doi";
import { Scraper, ScraperRequestType } from "./scraper";

interface ResponseType {
  total: number;
  data: [
    {
      title: string;
      authors?: { name: string }[];
      year?: string;
      publicationVenue?: {
        name: string;
        type: string;
      };
      journal?: {
        name?: string;
        pages?: string;
        volume?: string;
      };
      externalIds?: {
        ArXiv?: string;
        DOI?: string;
      };
    },
  ];
}

export class SemanticScholarScraper extends Scraper {
  static checkEnable(paperEntityDraft: PaperEntity): boolean {
    return paperEntityDraft.title !== "";
  }

  static preProcess(paperEntityDraft: PaperEntity): ScraperRequestType {
    const scrapeURL = `https://api.semanticscholar.org/graph/v1/paper/search?query=${stringUtils.formatString(
      {
        str: paperEntityDraft.title,
        whiteSymbol: true,
      },
    )}&limit=10&fields=externalIds,authors,title,year,journal,publicationVenue`;

    const headers = {};

    return { scrapeURL, headers, sim_threshold: 0.95 };
  }

  static parsingProcess(rawResponse: string): PaperEntity[] {
    const parsedResponse = JSON.parse(rawResponse) as {
      total: number;
      data: [
        {
          title: string;
          authors?: { name: string }[];
          publicationVenue?: {
            name?: string;
            type?: string;
          };
          journal?: {
            name?: string;
            pages?: string;
            volume?: string;
          };
          year?: string;
          externalIds?: {
            ArXiv?: string;
            DOI?: string;
          };
        },
      ];
    };

    const candidatePaperEntityDrafts: PaperEntity[] = [];

    if (parsedResponse.total === 0) {
      return candidatePaperEntityDrafts;
    }

    for (const item of parsedResponse.data) {
      const candidatePaperEntityDraft = new PaperEntity();

      candidatePaperEntityDraft.title = item.title;
      candidatePaperEntityDraft.authors =
        item.authors?.map((author) => author.name).join(", ") ||
        candidatePaperEntityDraft.authors;
      if (
        item.publicationVenue &&
        item.publicationVenue.name &&
        item.publicationVenue.type
      ) {
        if (item.publicationVenue.type.includes("journal")) {
          candidatePaperEntityDraft.pubType = 0;
        } else if (item.publicationVenue.type.includes("book")) {
          candidatePaperEntityDraft.pubType = 3;
        } else if (item.publicationVenue.type.includes("conference")) {
          candidatePaperEntityDraft.pubType = 1;
        } else {
          candidatePaperEntityDraft.pubType = 2;
        }
        candidatePaperEntityDraft.publication =
          item.publicationVenue.name.replaceAll("&amp;", "&");
      }
      candidatePaperEntityDraft.pubTime = item.year ? `${item.year}` : "";
      candidatePaperEntityDraft.volume = item.journal?.volume || "";
      candidatePaperEntityDraft.pages = item.journal?.pages || "";

      candidatePaperEntityDraft.arxiv = item.externalIds?.ArXiv || "";
      candidatePaperEntityDraft.doi = item.externalIds?.DOI || "";

      candidatePaperEntityDrafts.push(candidatePaperEntityDraft);
    }

    return candidatePaperEntityDrafts;
  }

  static async scrape(paperEntityDraft: PaperEntity, force = false): Promise<PaperEntity> {
    if (!this.checkEnable(paperEntityDraft) && !force) {
      return paperEntityDraft;
    }

    const { scrapeURL, headers, sim_threshold } =
      this.preProcess(paperEntityDraft);

    const response = await PLExtAPI.networkTool.get(
      scrapeURL,
      headers,
      1,
      10000,
    );
    const candidatePaperEntityDrafts = this.parsingProcess(response.body);

    let updatedPaperEntityDraft = this.matchingProcess(
      paperEntityDraft,
      candidatePaperEntityDrafts,
      sim_threshold,
    );

    if (updatedPaperEntityDraft.doi) {
      const authorListfromSemanticScholar =
        updatedPaperEntityDraft.authors.split(", ");

      updatedPaperEntityDraft = await DOIScraper.scrape(
        updatedPaperEntityDraft,
      );

      // Sometimes DOI returns incomplete author list, so we use Semantic Scholar's author list if it is longer
      if (
        updatedPaperEntityDraft.authors.split(", ").length <
        authorListfromSemanticScholar.length
      ) {
        updatedPaperEntityDraft.authors =
          authorListfromSemanticScholar.join(", ");
      }
    }
    return updatedPaperEntityDraft;
  }
}
