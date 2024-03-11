import { PLExtAPI } from "paperlib-api/api";
import { PaperEntity } from "paperlib-api/model";

import { bibtex2json } from "@/utils/bibtex";

import { Scraper, ScraperRequestType } from "./scraper";
import { isEmpty } from "@/utils/string";
import { DBLPVenueScraper } from "./dblp-venue";

export class OpenreviewScraper extends Scraper {
  static checkEnable(paperEntityDraft: PaperEntity): boolean {
    return !isEmpty(paperEntityDraft.title);
  }

  static preProcess(paperEntityDraft: PaperEntity): ScraperRequestType {
    const scrapeURL = `https://api.openreview.net/notes/search?content=all&group=all&limit=10&term=${paperEntityDraft.title}&type=terms`;

    const headers = {
      Accept: "application/json",
    };

    return { scrapeURL, headers, sim_threshold: 0.95 };
  }

  static parsingProcessAPI1(rawResponse: string): PaperEntity[] {
    const notes = (
      JSON.parse(rawResponse) as {
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
    ).notes;

    const candidatePaperEntityDrafts: PaperEntity[] = [];
    for (const note of notes) {
      if (
        !note.content.venue?.includes("Submitted to") &&
        !note.content.venue?.includes("Rejected by") &&
        !note.content.venue?.includes("CoRR") &&
        note.content.authors !== undefined
      ) {
        const candidatePaperEntityDraft = new PaperEntity();

        candidatePaperEntityDraft.title = note.content.title.replaceAll(
          "&amp;",
          "&",
        );
        candidatePaperEntityDraft.authors = note.content.authors.join(", ");

        if (note.content._bibtex) {
          const parsedBibTexs = bibtex2json(note.content._bibtex);
          if (parsedBibTexs.length > 0) {
            const parsedBibTex = parsedBibTexs[0];
            candidatePaperEntityDraft.publication =
              parsedBibTex["container-title"];
            candidatePaperEntityDraft.pubTime = `${parsedBibTex["issued"]["date-parts"][0][0]}`;
            if (parsedBibTex["type"].includes("conference")) {
              candidatePaperEntityDraft.pubType = 1;
            } else if (parsedBibTex["type"].includes("journal")) {
              candidatePaperEntityDraft.pubType = 0;
            } else {
              candidatePaperEntityDraft.pubType = 2;
            }
          }
        } else {
          let publication: string;
          if (note.content.venueid && note.content.venueid.includes("dblp")) {
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
          candidatePaperEntityDraft.publication = publication;

          const pubTimeReg = (
            note.content.venueid ||
            note.content.venue ||
            ""
          ).match(/\d{4}/g);
          const pubTime = pubTimeReg ? pubTimeReg[0] : "";

          candidatePaperEntityDraft.pubTime = `${pubTime}`;
        }

        candidatePaperEntityDrafts.push(candidatePaperEntityDraft);
      }
    }

    return candidatePaperEntityDrafts;
  }

  static parsingProcessAPI2(rawResponse: string): PaperEntity[] {
    const notes = (
      JSON.parse(rawResponse) as {
        notes: {
          content: {
            title: { value: string };
            authors?: { value: string[] };
            venueid?: { value: string };
            venue: { value: string };
            _bibtex: { value: string };
          };
        }[];
      }
    ).notes;

    const candidatePaperEntityDrafts: PaperEntity[] = [];

    for (const note of notes) {
      if (
        !note.content.venue?.value.includes("Submitted to") &&
        !note.content.venue?.value.includes("Rejected by") &&
        !note.content.venue?.value.includes("CoRR") &&
        note.content.authors !== undefined
      ) {
        const candidatePaperEntityDraft = new PaperEntity();

        candidatePaperEntityDraft.title = note.content.title.value.replaceAll(
          "&amp;",
          "&",
        );
        candidatePaperEntityDraft.authors = note.content.authors.value.join(", ");
        if (note.content._bibtex) {
          const parsedBibTexs = bibtex2json(note.content._bibtex.value);
          if (parsedBibTexs.length > 0) {
            const parsedBibTex = parsedBibTexs[0];
            candidatePaperEntityDraft.publication =
              parsedBibTex["container-title"];
            candidatePaperEntityDraft.pubTime = `${parsedBibTex["issued"]["date-parts"][0][0]}`;
            if (parsedBibTex["type"].includes("conference")) {
              candidatePaperEntityDraft.pubType = 1;
            } else if (parsedBibTex["type"].includes("journal")) {
              candidatePaperEntityDraft.pubType = 0;
            } else {
              candidatePaperEntityDraft.pubType = 2;
            }
          }
        } else {
          let publication: string;
          if (
            note.content.venueid &&
            note.content.venueid.value.includes("dblp")
          ) {
            const type = note.content.venueid.value.includes("conf")
              ? "conf"
              : "journals";

            const venueID =
              type +
              "/" +
              note.content.venueid.value.split("/")[2].toLowerCase();
            if (!venueID.includes("journals/corr")) {
              publication = `dblp://${JSON.stringify({
                venueID: venueID,
                paperKey: "",
              })}`;
            } else {
              publication = "";
            }
          } else if (note.content.venue) {
            publication = note.content.venue.value;
          } else {
            publication = "Openreview.net";
          }
          candidatePaperEntityDraft.publication = publication;

          const pubTimeReg = (
            note.content.venueid?.value ||
            note.content.venue.value ||
            ""
          ).match(/\d{4}/g);
          const pubTime = pubTimeReg ? pubTimeReg[0] : "";

          candidatePaperEntityDraft.pubTime = `${pubTime}`;
        }

        candidatePaperEntityDrafts.push(candidatePaperEntityDraft);
      }
    }

    return candidatePaperEntityDrafts;
  }

  static async scrape(paperEntityDraft: PaperEntity, force = false): Promise<PaperEntity> {
    if (!this.checkEnable(paperEntityDraft) && !force) {
      return paperEntityDraft;
    }

    let { scrapeURL, headers, sim_threshold } = this.preProcess(paperEntityDraft);
    const responses = await Promise.all([
      PLExtAPI.networkTool.get(scrapeURL, headers, 1, 5000),
      PLExtAPI.networkTool.get(
          scrapeURL.replace(
            "https://api.openreview.net",
            "https://api2.openreview.net",
          ),
          headers,
          1,
          5000,
      )
    ]);

    const candidatePaperEntityDrafts = [
      ...this.parsingProcessAPI1(responses[0].body),
      ...this.parsingProcessAPI2(responses[1].body),
    ];

    let updatedPaperEntityDraft = this.matchingProcess(
      paperEntityDraft,
      candidatePaperEntityDrafts,
      sim_threshold,
    );

    // Request venue
    if (updatedPaperEntityDraft.publication.includes("dblp://")) {
      updatedPaperEntityDraft =
        await DBLPVenueScraper.scrape(updatedPaperEntityDraft);
    }

    return updatedPaperEntityDraft;
  }
}
