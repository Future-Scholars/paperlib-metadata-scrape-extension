import { PLAPI, PaperEntity, metadataUtils, stringUtils } from "paperlib-api";

import stringSimilarity from "string-similarity";

import { DOIScraper } from "./doi";
import { Scraper, ScraperRequestType } from "./scraper";

interface ResponseType {
  doi: string;
  vor?: {
    vorDoi: string;
  };
  title: string;
  statusDate: string;
  authors: {
    firstName: string;
    lastName: string;
  }[];
}

export class ChemRxivPreciseScraper extends Scraper {
  static checkEnable(paperEntityDraft: PaperEntity): boolean {
    return (
      paperEntityDraft.doi !== "" &&
      paperEntityDraft.doi.includes("chemrxiv") &&
      !metadataUtils.isMetadataCompleted(paperEntityDraft)
    );
  }

  static preProcess(paperEntityDraft: PaperEntity): ScraperRequestType {
    const scrapeURL = `https://chemrxiv.org/engage/chemrxiv/public-api/v1/items/doi/${paperEntityDraft.doi}`;
    const headers = {};

    return { scrapeURL, headers };
  }

  static parsingProcess(
    rawResponse: { body: string },
    paperEntityDraft: PaperEntity,
  ): PaperEntity {
    const parsedResponse = JSON.parse(rawResponse.body) as
      | ResponseType
      | { itemHits: ResponseType[] };
    let chemRxivResponses: ResponseType[];
    if (parsedResponse.hasOwnProperty("itemHits")) {
      chemRxivResponses = (parsedResponse as { itemHits: ResponseType[] })
        .itemHits;
    } else {
      chemRxivResponses = [parsedResponse as ResponseType];
    }

    for (const response of chemRxivResponses) {
      const plainHitTitle = stringUtils.formatString({
        str: response.title,
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

      if (response.doi === paperEntityDraft.doi || sim > 0.95) {
        paperEntityDraft.title = response.title;
        paperEntityDraft.authors = response.authors
          .map((a) => `${a.firstName} ${a.lastName}`)
          .join(", ");
        paperEntityDraft.pubTime = response.statusDate.slice(0, 4);
        if (response.vor) {
          paperEntityDraft.doi = response.vor.vorDoi;
        } else {
          paperEntityDraft.publication = "chemRxiv";
        }
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

    paperEntityDraft = await DOIScraper.scrape(paperEntityDraft);

    return paperEntityDraft;
  }
}

export class ChemRxivFuzzyScraper extends ChemRxivPreciseScraper {
  static checkEnable(paperEntityDraft: PaperEntity): boolean {
    return (
      paperEntityDraft.title !== "" &&
      !metadataUtils.isMetadataCompleted(paperEntityDraft)
    );
  }

  static preProcess(paperEntityDraft: PaperEntity): ScraperRequestType {
    const scrapeURL = `https://chemrxiv.org/engage/chemrxiv/public-api/v1/items?term=${paperEntityDraft.title}`;
    const headers = {};

    return { scrapeURL, headers };
  }
}
