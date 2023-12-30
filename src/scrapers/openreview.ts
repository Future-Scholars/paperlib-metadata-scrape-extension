import { PLAPI, PaperEntity, stringUtils } from "paperlib-api";
import stringSimilarity from "string-similarity";

import { bibtex2json } from "@/utils/bibtex";

import { DBLPScraper } from "./dblp";
import { Scraper, ScraperRequestType } from "./scraper";

interface ResponseType {
  notes: {
    content: {
      title: string;
      authors: string[];
      venueid?: string;
      venue: string;
      _bibtex: string;
    };
  }[];
}

export class OpenreviewScraper extends Scraper {
  static checkEnable(paperEntityDraft: PaperEntity): boolean {
    return paperEntityDraft.title !== "";
  }

  static preProcess(paperEntityDraft: PaperEntity): ScraperRequestType {
    const scrapeURL = `https://api.openreview.net/notes/search?content=all&group=all&limit=10&source=forum&term=${paperEntityDraft.title}&type=terms`;

    const headers = {
      Accept: "application/json",
    };

    return { scrapeURL, headers };
  }

  static parsingProcess(
    rawResponse: { body: string },
    paperEntityDraft: PaperEntity,
  ): PaperEntity {
    const notes = (JSON.parse(rawResponse.body) as ResponseType).notes;

    for (const note of notes) {
      const plainHitTitle = stringUtils.formatString({
        str: note.content.title,
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
      if (sim > 0.95) {
        const title = note.content.title.replaceAll("&amp;", "&");
        const authors = note.content.authors.join(", ");

        paperEntityDraft.title = title;
        paperEntityDraft.authors = authors;

        if (note.content.venue) {
          if (
            !note.content.venue.includes("Submitted") &&
            !note.content.venue.includes("CoRR")
          ) {
            if (note.content.venue.toLowerCase().includes("accept")) {
              const parsedBibTexs = bibtex2json(note.content._bibtex);
              if (parsedBibTexs.length > 0) {
                const parsedBibTex = parsedBibTexs[0];
                paperEntityDraft.publication = parsedBibTex["container-title"];
                paperEntityDraft.pubTime = `${parsedBibTex["issued"]["date-parts"][0][0]}`;
                if (parsedBibTex["type"].includes("conference")) {
                  paperEntityDraft.pubType = 1;
                } else if (parsedBibTex["type"].includes("journal")) {
                  paperEntityDraft.pubType = 0;
                } else {
                  paperEntityDraft.pubType = 2;
                }
              }
            } else {
              let publication;
              if (
                note.content.venueid &&
                note.content.venueid.includes("dblp")
              ) {
                const type = note.content.venueid.includes("conf")
                  ? "conf"
                  : "journals";

                const venueID =
                  type + "/" + note.content.venueid.split("/")[2].toLowerCase();
                if (!venueID.includes("journals/corr")) {
                  publication = `dblp://${JSON.stringify({
                    venueID: venueID,
                    paperKey: "",
                  })}`;
                } else {
                  publication = "";
                }
              } else {
                publication = note.content.venue;
              }

              const pubTimeReg = (
                note.content.venueid || note.content.venue
              ).match(/\d{4}/g);
              const pubTime = pubTimeReg ? pubTimeReg[0] : "";

              paperEntityDraft.pubTime = `${pubTime}`;
              paperEntityDraft.publication = publication;
            }
          }
        } else {
          if (note.content._bibtex && note.content._bibtex.includes("year={")) {
            const pubTimeReg = note.content._bibtex.match(/year={(\d{4})/);
            const pubTime = pubTimeReg ? pubTimeReg[1] : "";
            paperEntityDraft.pubTime = `${pubTime}`;
          }
          paperEntityDraft.publication = "openreview.net";
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
    paperEntityDraft = this.parsingProcess(response, paperEntityDraft);

    if (paperEntityDraft.publication.includes("dblp")) {
      const { venueID, paperKey } = JSON.parse(
        paperEntityDraft.publication.replace("dblp://", ""),
      ) as { venueID: string; paperKey: string };
      const venueScrapeURL =
        "https://dblp.org/search/venue/api?q=" + venueID + "&format=json";

      const rawSearchResponse = await DBLPScraper._scrapeRequest(
        venueScrapeURL,
        headers,
      );

      // Try to fetch bib to handel workshop papers
      const bibURL = `https://dblp.org/rec/${paperKey}.bib?param=1`;
      const rawBibResponse = await DBLPScraper._scrapeRequest(bibURL, headers);

      paperEntityDraft = DBLPScraper.parsingProcessVenue(
        {
          apiResponse: rawSearchResponse,
          bibResponse: rawBibResponse,
        },
        paperEntityDraft,
        venueID,
      );
    }

    return paperEntityDraft;
  }
}
