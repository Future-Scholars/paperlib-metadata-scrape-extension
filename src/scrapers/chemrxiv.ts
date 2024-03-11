import { PLExtAPI } from "paperlib-api/api";
import { PaperEntity } from "paperlib-api/model";
import { stringUtils } from "paperlib-api/utils";

import stringSimilarity from "string-similarity";

import { DOIScraper } from "./doi";
import { Scraper, ScraperRequestType } from "./scraper";
import { isEmpty } from "@/utils/string";

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
      !isEmpty(paperEntityDraft.doi) && paperEntityDraft.doi.includes("chemrxiv")
    );
  }

  static preProcess(paperEntityDraft: PaperEntity): ScraperRequestType {
    const scrapeURL = `https://chemrxiv.org/engage/chemrxiv/public-api/v1/items/doi/${paperEntityDraft.doi}`;
    const headers = {};

    return { scrapeURL, headers, sim_threshold: 0.95 };
  }

  static parsingProcess(
    rawResponse: string
  ): PaperEntity[] {
    const parsedResponse = JSON.parse(rawResponse) as
    | ResponseType
    | { itemHits: ResponseType[] };
  let chemRxivResponses: ResponseType[];
  if (parsedResponse.hasOwnProperty("itemHits")) {
    chemRxivResponses = (parsedResponse as { itemHits: ResponseType[] })
      .itemHits;
  } else {
    chemRxivResponses = [parsedResponse as ResponseType];
  }

  const candidatePaperEntityDrafts: PaperEntity[] = [];

  for (const response of chemRxivResponses) {
    let item: ResponseType;
    if ((response as any).item) {
      item = (response as any).item;
    } else {
      item = response;
    }
    const candidatePaperEntityDraft = new PaperEntity();
    candidatePaperEntityDraft.title = item.title;
    candidatePaperEntityDraft.authors = item.authors
      .map((a) => `${a.firstName} ${a.lastName}`)
      .join(", ");
    candidatePaperEntityDraft.pubTime = item.statusDate.slice(0, 4);
    if (item.vor) {
      candidatePaperEntityDraft.doi = item.vor.vorDoi;
    } else {
      candidatePaperEntityDraft.publication = "chemRxiv";
    }

    candidatePaperEntityDrafts.push(candidatePaperEntityDraft);
  }
  return candidatePaperEntityDrafts;
  }

  static async scrape(
    paperEntityDraft: PaperEntity,
    force = false,
  ): Promise<PaperEntity> {
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
      false,
      false
    );
    const candidatePaperEntityDrafts = this.parsingProcess(response.body);

    let updatedPaperEntityDraft = this.matchingProcess(
      paperEntityDraft,
      candidatePaperEntityDrafts,
      sim_threshold,
    );

    updatedPaperEntityDraft = await DOIScraper.scrape(updatedPaperEntityDraft);

    return updatedPaperEntityDraft;
  }
}

export class ChemRxivFuzzyScraper extends ChemRxivPreciseScraper {
  static checkEnable(paperEntityDraft: PaperEntity): boolean {
    return paperEntityDraft.title !== "";
  }

  static preProcess(paperEntityDraft: PaperEntity): ScraperRequestType {
    const scrapeURL = `https://chemrxiv.org/engage/chemrxiv/public-api/v1/items?term=${paperEntityDraft.title}`;
    const headers = {};

    return { scrapeURL, headers, sim_threshold: 0.95};
  }
}
