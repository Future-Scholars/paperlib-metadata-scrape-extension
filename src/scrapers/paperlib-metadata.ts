import { PLExtAPI } from "paperlib-api/api";
import { PaperEntity } from "paperlib-api/model";
import { stringUtils } from "paperlib-api/utils";

import { ScraperRequestType } from "@/scrapers/scraper";

interface ResponseType {
  title: string;
  minifiedtitle: string;
  authors: string;
  publication: string;
  pubTime: string;
  pubType: number;
  doi: string;
  arxiv: string;
  pages: string;
  volume: string;
  number: string;
  publisher: string;
  source: string;
  codes: string[];
}

export class PaperlibMetadataServiceScraper {
  static checkEnable(paperEntityDraft: PaperEntity): boolean {
    return (
      paperEntityDraft.title !== "" ||
      paperEntityDraft.arxiv !== "" ||
      paperEntityDraft.doi !== ""
    );
  }

  static preProcess(
    paperEntityDraft: PaperEntity,
    scrapers: string[],
  ): ScraperRequestType {
    const title = stringUtils.formatString({
      str: paperEntityDraft.title,
      removeNewline: true,
      removeStr: "&amp;",
    });
    let scrapeURL = `https://api.paperlib.app/metadata/query?scrapers=${scrapers.join(
      ",",
    )}&`;
    const queryParams: string[] = [];
    if (title) {
      queryParams.push(`title=${title}`);
    }
    if (paperEntityDraft.arxiv) {
      queryParams.push(`arxiv=${paperEntityDraft.arxiv}`);
    }
    if (paperEntityDraft.doi) {
      queryParams.push(`doi=${paperEntityDraft.doi}`);
    }
    scrapeURL += queryParams.join("&");

    const headers = {};

    return { scrapeURL, headers, sim_threshold: -1 };
  }

  static parsingProcess(
    rawResponse: ResponseType,
    paperEntityDraft: PaperEntity,
  ): PaperEntity {
    const response = rawResponse;

    paperEntityDraft.title = response.title;
    paperEntityDraft.authors = response.authors || paperEntityDraft.authors;
    paperEntityDraft.publication = response.publication || paperEntityDraft.publication;
    paperEntityDraft.pubTime = response.pubTime || paperEntityDraft.pubTime;
    paperEntityDraft.pubType = response.pubType || paperEntityDraft.pubType;
    paperEntityDraft.doi = response.doi || paperEntityDraft.doi;
    paperEntityDraft.arxiv = response.arxiv || paperEntityDraft.arxiv;
    paperEntityDraft.pages = response.pages || paperEntityDraft.pages;
    paperEntityDraft.volume = response.volume || paperEntityDraft.volume;
    paperEntityDraft.number = response.number || paperEntityDraft.number;
    paperEntityDraft.publisher = response.publisher || paperEntityDraft.publisher;
    paperEntityDraft.codes = response.codes || paperEntityDraft.codes;

    return paperEntityDraft;
  }

  static async scrape(
    paperEntityDraft: PaperEntity,
    scrapers: string[],
    force = false,
  ): Promise<PaperEntity> {
    if (!this.checkEnable(paperEntityDraft) && !force) {
      return paperEntityDraft;
    }

    let { scrapeURL, headers } = this.preProcess(paperEntityDraft, scrapers);

    const response = await PLExtAPI.networkTool.get(
      scrapeURL,
      headers,
      1,
      15000,
      false,
      true,
    );
    return this.parsingProcess(response.body, paperEntityDraft);
  }
}
