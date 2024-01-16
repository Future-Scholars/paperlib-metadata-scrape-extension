import { PLExtAPI } from "paperlib-api/api";
import { PaperEntity } from "paperlib-api/model";
import { metadataUtils } from "paperlib-api/utils";

export interface ScraperRequestType {
  scrapeURL: string;
  headers: Record<string, string>;
  content?: Record<string, any>;
}

export class Scraper {
  // All use static methods seems to be a better design for cross scrapers calls.

  static async scrape(paperEntityDraft: PaperEntity): Promise<PaperEntity> {
    if (!this.checkEnable(paperEntityDraft)) {
      return paperEntityDraft;
    }

    const { scrapeURL, headers } = this.preProcess(paperEntityDraft);

    const response = await PLExtAPI.networkTool.get(
      scrapeURL,
      headers,
      1,
      10000,
      false,
      true,
    );
    return this.parsingProcess(response, paperEntityDraft);
  }

  static preProcess(paperEntityDraft: PaperEntity): ScraperRequestType {
    return { scrapeURL: "", headers: {} };
  }

  static parsingProcess(
    rawResponse: any,
    paperEntityDraft: PaperEntity,
  ): PaperEntity {
    return paperEntityDraft;
  }

  // Check if the  paperEntityDraft contains enough information to scrape. (NOT enable or not by user preference)
  static checkEnable(paperEntityDraft: PaperEntity): boolean {
    return !metadataUtils.isMetadataCompleted(paperEntityDraft);
  }
}
