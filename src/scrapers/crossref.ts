import { PLExtAPI } from "paperlib-api/api";
import { PaperEntity } from "paperlib-api/model";
import { stringUtils } from "paperlib-api/utils";

import { isEmpty } from "@/utils/string";
import { Scraper, ScraperRequestType } from "./scraper";

export class CrossRefScraper extends Scraper {
  static checkEnable(paperEntityDraft: PaperEntity): boolean {
    return !isEmpty(paperEntityDraft.doi) || !isEmpty(paperEntityDraft.title);
  }

  static preProcess(paperEntityDraft: PaperEntity): ScraperRequestType {
    let scrapeURL;
    if (
      paperEntityDraft.doi &&
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
    return { scrapeURL, headers, sim_threshold: 0.95 };
  }

  static parsingProcess(rawResponse: string, fromDOI = false): PaperEntity[] {
    let parsedResponse;

    if (fromDOI) {
      parsedResponse = JSON.parse(rawResponse) as {
        message: HitItem;
      };
    } else {
      parsedResponse = JSON.parse(rawResponse) as {
        message: {
          items: HitItem[];
        };
      };
    }
    let hitItems;

    if (fromDOI) {
      hitItems = [parsedResponse.message as HitItem];
    } else {
      hitItems = parsedResponse.message.items as HitItem[];
    }

    const candidatePaperEntityDrafts: PaperEntity[] = [];
    for (const item of hitItems) {
      const candidatePaperEntityDraft = new PaperEntity();
      candidatePaperEntityDraft.title = item.title[0];
      candidatePaperEntityDraft.doi = item.DOI;
      candidatePaperEntityDraft.publisher = item.publisher;

      if (item.type?.includes("journal")) {
        candidatePaperEntityDraft.pubType = 0;
      } else if (
        item.type?.includes("book") ||
        item.type?.includes("monograph")
      ) {
        candidatePaperEntityDraft.pubType = 3;
      } else if (item.type?.includes("proceedings")) {
        candidatePaperEntityDraft.pubType = 1;
      } else {
        candidatePaperEntityDraft.pubType = 2;
      }

      candidatePaperEntityDraft.pages = item.page;

      let publication;
      if (item.type?.includes("monograph")) {
        publication = item.publisher;
      } else {
        publication = item["container-title"]?.join(", ");
      }

      candidatePaperEntityDraft.publication =
        publication?.replaceAll("&amp;", "&") || "";
      let pubTime = "";
      try {
        pubTime = `${item["published-print"]["date-parts"][0][0]}`;
      } catch (e) {
        pubTime = `${item.published?.["date-parts"]?.[0]?.[0]}`;
      }
      candidatePaperEntityDraft.pubTime = pubTime;
      candidatePaperEntityDraft.authors = item.author
        ?.map((author) => `${author.given} ${author.family}`)
        .join(", ");
      candidatePaperEntityDraft.number = item.issue;
      candidatePaperEntityDraft.volume = item.volume;

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

    let { scrapeURL, headers, sim_threshold } =
      this.preProcess(paperEntityDraft);

    let candidatePaperEntityDrafts: PaperEntity[] = [];
    if (scrapeURL.startsWith("https://api.crossref.org")) {
      let response: { body: string } = { body: "" };
      if (scrapeURL.includes("bibliographic")) {
        const publicScrapeURL = scrapeURL.replace(
          "&mailto=hi@paperlib.app",
          "",
        );

        response = await Promise.any([
          PLExtAPI.networkTool.get(publicScrapeURL, headers, 1, 10000),
          PLExtAPI.networkTool.get(scrapeURL, headers, 1, 10000),
        ]);
      } else {
        response = await PLExtAPI.networkTool.get(scrapeURL, headers, 1, 10000);
        sim_threshold = -1;
      }

      candidatePaperEntityDrafts = this.parsingProcess(
        response.body,
        !scrapeURL.includes("bibliographic"),
      );
    } else {
      const response = await PLExtAPI.networkTool.get(
        scrapeURL,
        headers,
        1,
        10000,
      );

      const potentialDOI = response.body
        .split("|")
        .pop()
        ?.match(/10.\d{4,9}\/[-._;()/:A-Z0-9]+/gim);
      if (!potentialDOI) {
        // const fallbackScrapeURL = encodeURI(
        //   `https://api.crossref.org/works?query.bibliographic=${formatString({
        //     str: paperEntityDraft.title,
        //     whiteSymbol: true,
        //   })}&rows=2&mailto=hi@paperlib.app`,
        // );
        // const response = (await networkGet(
        //   fallbackScrapeURL,
        //   headers,
        //   10000,
        //   true,
        // )) as Response<string>;
        // return this.parsingProcess(response, paperEntityDraft, false);
        return paperEntityDraft;
      } else {
        const response = await PLExtAPI.networkTool.get(
          `https://api.crossref.org/works/${potentialDOI[0]}`,
          headers,
          1,
          10000,
        );
        candidatePaperEntityDrafts = this.parsingProcess(response.body, true);
      }
    }

    const updatedPaperEntityDraft = this.matchingProcess(
      paperEntityDraft,
      candidatePaperEntityDrafts,
      sim_threshold,
    );

    return updatedPaperEntityDraft;
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
