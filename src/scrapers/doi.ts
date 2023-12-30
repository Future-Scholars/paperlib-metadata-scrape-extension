import { PaperEntity, stringUtils } from "paperlib-api";

import { Scraper, ScraperRequestType } from "./scraper";

interface ResponseType {
  title: string;
  author?: { given?: string; family?: string; name?: string }[];
  published?: {
    "date-parts": { "0": string[] };
  };
  type: string;
  "container-title"?: string | string[];
  publisher: string;
  page: string;
  volume: string;
  issue: string;
  subtitle?: string[];
  institution?: [{ name: string }];
}

export class DOIScraper extends Scraper {
  static checkEnable(paperEntityDraft: PaperEntity): boolean {
    return paperEntityDraft.doi !== "";
  }

  static preProcess(paperEntityDraft: PaperEntity): ScraperRequestType {
    const doiID = stringUtils.formatString({
      str: paperEntityDraft.doi,
      removeNewline: true,
      removeWhite: true,
    });
    const scrapeURL = `https://dx.doi.org/${doiID}`;
    const headers = {
      Accept: "application/json",
    };

    return { scrapeURL, headers };
  }

  static parsingProcess(
    rawResponse: { body: string; headers: Record<string, string> },
    paperEntityDraft: PaperEntity,
  ): PaperEntity {
    if (rawResponse.body.startsWith("<")) {
      return paperEntityDraft;
    }

    const response = JSON.parse(rawResponse.body) as ResponseType;
    const title = [
      response.title,
      response.subtitle ? response.subtitle.join(" ") : "",
    ]
      .filter((t) => t !== "")
      .join(" - ")
      .replaceAll("&amp;", "&");
    const authors = response.author
      ? response.author
          .map((author) => {
            if (author.name) {
              return author.name;
            } else {
              return author.given?.trim() + " " + author.family?.trim();
            }
          })
          .join(", ")
      : "";

    let pubTime = "";
    try {
      pubTime = response["published-print"]["date-parts"][0][0];
    } catch (e) {
      pubTime = response.published
        ? response.published["date-parts"]["0"][0]
        : "";
    }

    let pubType;
    if (response.type == "proceedings-article") {
      pubType = 1;
    } else if (response.type == "journal-article") {
      pubType = 0;
    } else if (
      response.type.includes("book") ||
      response.type.includes("monograph")
    ) {
      pubType = 3;
    } else {
      pubType = 2;
    }

    let publication;
    if (response.type.includes("monograph")) {
      publication = response.publisher.replaceAll("&amp;", "&");
    } else {
      publication = response["container-title"];
      if (publication) {
        if (Array.isArray(publication)) {
          publication = publication.join(", ").replaceAll("&amp;", "&");
        } else {
          publication = publication.replaceAll("&amp;", "&");
        }
      } else {
        publication = "";
      }
    }

    if (response.institution && response.institution.length > 0) {
      if (response.institution[0].name === "medRxiv") {
        publication = "medRxiv";
      } else if (response.institution[0].name === "bioRxiv") {
        publication = "bioRxiv";
      }
    }

    paperEntityDraft.title = title;
    paperEntityDraft.authors = authors;
    paperEntityDraft.pubTime = `${pubTime}`;
    paperEntityDraft.pubType = pubType;
    paperEntityDraft.publication = publication;
    if (response.volume) {
      paperEntityDraft.volume = response.volume;
    }
    if (response.issue) {
      paperEntityDraft.number = response.issue;
    }
    if (response.page) {
      paperEntityDraft.pages = response.page;
    }
    if (response.publisher) {
      paperEntityDraft.publisher =
        response.publisher ===
        "Institute of Electrical and Electronics Engineers (IEEE)"
          ? "IEEE"
          : response.publisher;
    }
    return paperEntityDraft;
  }
}
