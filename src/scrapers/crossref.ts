import { PLAPI, PaperEntity, stringUtils } from "paperlib-api";
import stringSimilarity from "string-similarity";

import { Scraper, ScraperRequestType } from "./scraper";

export class CrossRefScraper extends Scraper {
  static checkEnable(paperEntityDraft: PaperEntity): boolean {
    return (
      (paperEntityDraft.title !== "" || paperEntityDraft.doi !== "") &&
      !paperEntityDraft.doi.toLowerCase().includes("arxiv")
    );
  }

  static preProcess(paperEntityDraft: PaperEntity): ScraperRequestType {
    let scrapeURL;
    if (
      paperEntityDraft.doi !== "" &&
      !paperEntityDraft.doi.toLowerCase().includes("arxiv")
    ) {
      scrapeURL = `https://api.crossref.org/works/${encodeURIComponent(
        paperEntityDraft.doi,
      )}`;
    } else if (
      paperEntityDraft.title !== "" &&
      paperEntityDraft.authors !== ""
    ) {
      scrapeURL = `https://doi.crossref.org/servlet/query?usr=hi@paperlib.app&qdata=<?xml version = "1.0" encoding="UTF-8"?><query_batch xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" version="2.0" xmlns="http://www.crossref.org/qschema/2.0"  xsi:schemaLocation="http://www.crossref.org/qschema/2.0 http://www.crossref.org/qschema/crossref_query_input2.0.xsd"><head><email_address>support@crossref.org</email_address><doi_batch_id>ABC_123_fff</doi_batch_id> </head> <body> <query enable-multiple-hits="false" secondary-query="author-title" key="key1"> <article_title match="fuzzy">${paperEntityDraft.title.replaceAll(
        "&",
        "",
      )}</article_title> <author search-all-authors="true">${paperEntityDraft.authors
        .split(",")[0]
        .trim()
        .split(" ")
        .pop()}</author> </query></body></query_batch>`;
    } else {
      scrapeURL = encodeURI(
        `https://api.crossref.org/works?query.bibliographic=${stringUtils.formatString(
          {
            str: paperEntityDraft.title,
            whiteSymbol: true,
          },
        )}&rows=2&mailto=hi@paperlib.app`,
      );
    }

    const headers = {};
    return { scrapeURL, headers };
  }

  static parsingProcess(
    rawResponse: { body: string },
    paperEntityDraft: PaperEntity,
    fromDOI = false,
  ): PaperEntity {
    let parsedResponse;

    if (fromDOI) {
      parsedResponse = JSON.parse(rawResponse.body) as {
        message: HitItem;
      };
    } else {
      parsedResponse = JSON.parse(rawResponse.body) as {
        message: {
          items: HitItem[];
        };
      };
    }

    let hitItem;

    if (fromDOI) {
      hitItem = parsedResponse.message as HitItem;
    } else {
      const hitItems = parsedResponse.message as { items: HitItem[] };
      for (const item of hitItems.items) {
        const plainHitTitle = stringUtils.formatString({
          str: item.title[0],
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

        const sim = stringSimilarity.compareTwoStrings(
          plainHitTitle,
          existTitle,
        );
        if (sim > 0.95) {
          hitItem = item;
          break;
        }
      }
    }

    if (hitItem) {
      paperEntityDraft.title = hitItem.title[0];
      paperEntityDraft.doi = hitItem.DOI;
      paperEntityDraft.publisher = hitItem.publisher;

      if (hitItem.type?.includes("journal")) {
        paperEntityDraft.pubType = 0;
      } else if (
        hitItem.type?.includes("book") ||
        hitItem.type?.includes("monograph")
      ) {
        paperEntityDraft.pubType = 3;
      } else if (hitItem.type?.includes("proceedings")) {
        paperEntityDraft.pubType = 1;
      } else {
        paperEntityDraft.pubType = 2;
      }

      paperEntityDraft.pages = hitItem.page;

      let publication;
      if (hitItem.type?.includes("monograph")) {
        publication = hitItem.publisher;
      } else {
        publication = hitItem["container-title"]?.join(", ");
      }

      paperEntityDraft.publication =
        publication?.replaceAll("&amp;", "&") || "";

      let pubTime = "";
      try {
        pubTime = hitItem["published-print"]["date-parts"][0][0];
      } catch (e) {
        pubTime = `${hitItem.published?.["date-parts"]?.[0]?.[0]}`;
      }

      paperEntityDraft.pubTime = `${pubTime}`;
      paperEntityDraft.authors = hitItem.author
        ?.map((author) => `${author.given} ${author.family}`)
        .join(", ");
      paperEntityDraft.number = hitItem.issue;
      paperEntityDraft.volume = hitItem.volume;
    }

    return paperEntityDraft;
  }

  static async scrape(paperEntityDraft: PaperEntity): Promise<PaperEntity> {
    if (!this.checkEnable(paperEntityDraft)) {
      return paperEntityDraft;
    }

    const { scrapeURL, headers } = this.preProcess(paperEntityDraft);

    if (scrapeURL.startsWith("https://api.crossref.org")) {
      const response = (await PLAPI.networkTool.get(
        scrapeURL,
        headers,
        1,
        10000,
      )) as { body: string };
      return this.parsingProcess(
        response,
        paperEntityDraft,
        !scrapeURL.includes("bibliographic"),
      );
    } else {
      const response = (await PLAPI.networkTool.get(
        scrapeURL,
        headers,
        1,
        10000,
      )) as { body: string };

      const potentialDOI = response.body
        .split("|")
        .pop()
        ?.match(/10.\d{4,9}\/[-._;()/:A-Z0-9]+/gim);
      if (!potentialDOI) {
        return paperEntityDraft;
      } else {
        const response = (await PLAPI.networkTool.get(
          `https://api.crossref.org/works/${potentialDOI[0]}`,
          headers,
          1,
          10000,
        )) as { body: string };
        return this.parsingProcess(response, paperEntityDraft, true);
      }
    }
  }
}

interface HitItem {
  title: string[];
  DOI?: string;
  publisher?: string;
  type?: string;
  page?: string;
  author?: { given: string; family: string }[];
  "container-title"?: string[];
  published?: { "date-parts": number[][] };
  issue: string;
  volume: string;
}
