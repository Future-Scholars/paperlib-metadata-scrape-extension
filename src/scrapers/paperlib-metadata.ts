import { PLAPI, PaperEntity, stringUtils } from "paperlib-api";

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

    return { scrapeURL, headers };
  }

  static parsingProcess(
    rawResponse: { body: string; headers: Record<string, string> },
    paperEntityDraft: PaperEntity,
  ): PaperEntity {
    const response = JSON.parse(rawResponse.body) as ResponseType;

    paperEntityDraft.title = response.title;
    paperEntityDraft.authors = response.authors;
    paperEntityDraft.publication = response.publication;
    paperEntityDraft.pubTime = response.pubTime;
    paperEntityDraft.pubType = response.pubType;
    paperEntityDraft.doi = response.doi;
    paperEntityDraft.arxiv = response.arxiv;
    paperEntityDraft.pages = response.pages;
    paperEntityDraft.volume = response.volume;
    paperEntityDraft.number = response.number;
    paperEntityDraft.publisher = response.publisher;
    paperEntityDraft.codes = response.codes;

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

    if (force) {
      scrapeURL += "&force=true";
    }

    const response = (await PLAPI.networkTool.get(
      scrapeURL,
      headers,
      1,
      15000,
    )) as { body: string; headers: Record<string, string> };
    return this.parsingProcess(response, paperEntityDraft);
  }
}
