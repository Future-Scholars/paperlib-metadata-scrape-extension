import { PaperEntity } from "paperlib-api/model";
import { stringUtils } from "paperlib-api/utils";

import { isEmpty } from "@/utils/string";
import { Scraper, ScraperRequestType } from "./scraper";


export class DOIScraper extends Scraper {
  static checkEnable(paperEntityDraft: PaperEntity): boolean {
    return !isEmpty(paperEntityDraft.doi);
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

    return { scrapeURL, headers, sim_threshold: -1 };
  }

  static parsingProcess(rawResponse: string): PaperEntity[] {
    if (rawResponse.startsWith("<")) {
      return [];
    }

    const candidatePaperEntityDraft = new PaperEntity();

    const response = JSON.parse(rawResponse) as {
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
      number: string;
      subtitle?: string[];
      institution?: [{ name: string }];
    };

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
      pubTime = `${response["published-print"]["date-parts"][0][0]}`;
    } catch (e) {
      pubTime = response.published
        ? `${response.published["date-parts"]["0"][0]}`
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

    candidatePaperEntityDraft.title = title;
    candidatePaperEntityDraft.authors = authors;
    candidatePaperEntityDraft.pubTime = `${pubTime}`;
    candidatePaperEntityDraft.pubType = pubType;
    candidatePaperEntityDraft.publication = publication;
    if (response.volume) {
      candidatePaperEntityDraft.volume = response.volume;
    }
    if (response.issue) {
      candidatePaperEntityDraft.number = response.issue;
    }
    if (response.number) {
      candidatePaperEntityDraft.number = response.number;
    }
    if (response.page) {
      candidatePaperEntityDraft.pages = response.page;
    }
    if (response.publisher) {
      candidatePaperEntityDraft.publisher =
        response.publisher ===
        "Institute of Electrical and Electronics Engineers (IEEE)"
          ? "IEEE"
          : response.publisher;
    }
    return [candidatePaperEntityDraft];
  }
}
