import { PLAPI, PaperEntity, metadataUtils, stringUtils } from "paperlib-api";
import stringSimilarity from "string-similarity";

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
    return (
      paperEntityDraft.title !== "" &&
      !metadataUtils.isMetadataCompleted(paperEntityDraft)
    );
  }

  static preProcess(paperEntityDraft: PaperEntity): ScraperRequestType {
    const scrapeURL = `https://api.semanticscholar.org/graph/v1/paper/search?query=${stringUtils.formatString(
      {
        str: paperEntityDraft.title,
        whiteSymbol: true,
      },
    )}&limit=10&fields=externalIds,authors,title,year,journal,publicationVenue`;

    const headers = {};

    return { scrapeURL, headers };
  }

  static parsingProcess(
    rawResponse: { body: string },
    paperEntityDraft: PaperEntity,
  ): PaperEntity {
    const parsedResponse = JSON.parse(rawResponse.body) as ResponseType;

    if (parsedResponse.total === 0) {
      return paperEntityDraft;
    }

    for (const item of parsedResponse.data) {
      const plainHitTitle = stringUtils.formatString({
        str: item.title,
        removeStr: "&amp;",
        removeSymbol: true,
        lowercased: true,
      });

      const existTitle = stringUtils.formatString({
        str: paperEntityDraft.title,
        removeStr: "&amp;",
        removeSymbol: true,
        lowercased: true,
      });

      const sim = stringSimilarity.compareTwoStrings(plainHitTitle, existTitle);
      if (sim > 0.95) {
        if (
          item.publicationVenue &&
          item.publicationVenue.name &&
          item.publicationVenue.type
        ) {
          if (item.publicationVenue.type.includes("journal")) {
            paperEntityDraft.pubType = 0;
          } else if (item.publicationVenue.type.includes("book")) {
            paperEntityDraft.pubType = 3;
          } else if (item.publicationVenue.type.includes("conference")) {
            paperEntityDraft.pubType = 1;
          } else {
            paperEntityDraft.pubType = 2;
          }
        }

        if (item.journal?.name) {
          paperEntityDraft.publication = item.journal.name.replaceAll(
            "&amp;",
            "&",
          );
        } else {
          paperEntityDraft.publication =
            item.publicationVenue?.name.replaceAll("&amp;", "&") || "";
        }

        paperEntityDraft.pubTime = item.year ? `${item.year}` : "";
        paperEntityDraft.authors =
          item.authors?.map((author) => author.name).join(", ") || "";
        paperEntityDraft.volume = item.journal?.volume || "";
        paperEntityDraft.pages = item.journal?.pages || "";

        paperEntityDraft.arxiv = item.externalIds?.ArXiv || "";
        paperEntityDraft.doi = item.externalIds?.DOI || "";
        break;
      }
    }

    return paperEntityDraft;
  }

  static async scrape(
    paperEntityDraft: PaperEntity,
    force = false,
  ): Promise<PaperEntity> {
    if (!this.checkEnable(paperEntityDraft) && !force) {
      return paperEntityDraft;
    }

    const { scrapeURL, headers } = this.preProcess(paperEntityDraft);

    const response = (await PLAPI.networkTool.get(
      scrapeURL,
      headers,
      1,
      5000,
    )) as { body: string };
    paperEntityDraft = this.parsingProcess(
      response,
      paperEntityDraft,
    ) as PaperEntity;

    if (paperEntityDraft.doi) {
      const authorListfromSemanticScholar =
        paperEntityDraft.authors.split(", ");

      paperEntityDraft = await DOIScraper.scrape(paperEntityDraft);

      // Sometimes DOI returns incomplete author list, so we use Semantic Scholar's author list if it is longer
      if (
        paperEntityDraft.authors.split(", ").length <
        authorListfromSemanticScholar.length
      ) {
        paperEntityDraft.authors = authorListfromSemanticScholar.join(", ");
      }
    }
    return paperEntityDraft;
  }
}
