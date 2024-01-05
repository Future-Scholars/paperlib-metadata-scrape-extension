import { PLAPI } from "paperlib-api";
import { PaperEntity } from "paperlib-api/model";
import { stringUtils } from "paperlib-api/utils";

import stringSimilarity from "string-similarity";

import { DOIScraper } from "./doi";
import { Scraper, ScraperRequestType } from "./scraper";

interface ResponseType {
  doi: string;
  vor?: {
    vorDoi: string;
  };
  title: string;
  publishedDate: string;
  authors: {
    firstName: string;
    lastName: string;
  }[];
}

export class ChemRxivPreciseScraper extends Scraper {
  static checkEnable(paperEntityDraft: PaperEntity): boolean {
    return (
      paperEntityDraft.doi !== "" && paperEntityDraft.doi.includes("chemrxiv")
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
      let item: ResponseType;
      if ((response as any).item) {
        item = (response as any).item;
      } else {
        item = response;
      }

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

      if (item.doi === paperEntityDraft.doi || sim > 0.95) {
        paperEntityDraft.title = item.title;
        paperEntityDraft.authors = item.authors
          .map((a) => `${a.firstName} ${a.lastName}`)
          .join(", ");
        paperEntityDraft.pubTime = item.publishedDate.slice(0, 4);
        if (item.vor) {
          paperEntityDraft.doi = item.vor.vorDoi;
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
    return paperEntityDraft.title !== "";
  }

  static preProcess(paperEntityDraft: PaperEntity): ScraperRequestType {
    const scrapeURL = `https://chemrxiv.org/engage/chemrxiv/public-api/v1/items?term=${paperEntityDraft.title}`;
    const headers = {};

    return { scrapeURL, headers };
  }
}
