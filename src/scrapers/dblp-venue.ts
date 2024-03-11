import { PaperEntity } from "paperlib-api/model";

import { Scraper } from "./scraper";
import { DBLPScraper } from "./dblp";
import { bibtex2json } from "@/utils/bibtex";


export class DBLPVenueScraper extends Scraper {
  static checkEnable(paperEntityDraft: PaperEntity): boolean {
    return paperEntityDraft.publication.startsWith("dblp://");
  }

  static preProcessVenue(paperEntityDraft: PaperEntity) {
    const { venueID, paperKey } = JSON.parse(
      paperEntityDraft.publication.replace("dblp://", ""),
    ) as { venueID: string; paperKey: string };
    let scrapeURL =
      "https://dblp.org/search/venue/api?q=" + venueID + "&format=json";

    const bibURL = `https://dblp.org/rec/${paperKey}.bib?param=1`;

    const headers = {};

    scrapeURL += `|${bibURL}`;

    return { scrapeURL, headers, venueID };
  }

  static parsingProcessVenue(
    rawResponse: {
      apiResponse: string;
      bibResponse: string;
    },
    venueID: string,
  ): PaperEntity[] {
    const { apiResponse, bibResponse } = rawResponse;

    const response = JSON.parse(apiResponse) as {
      result: {
        hits: {
          "@sent": number;
          hit: {
            info: {
              url: string;
              venue: string;
            };
          }[];
        };
      };
    };

    let candidatePaperEntityDrafts: PaperEntity[] = [];
    if (response.result.hits["@sent"] > 0) {
      const hits = response.result.hits.hit;
      for (const hit of hits) {
        const candidatePaperEntityDraft = new PaperEntity();

        const venueInfo = hit["info"];
        candidatePaperEntityDraft.publication = JSON.stringify(venueInfo);
        candidatePaperEntityDrafts.push(candidatePaperEntityDraft);
      }
    }

    // handle workshop
    try {
      const bibtex = bibtex2json(bibResponse);
      if (bibtex[0]["container-title"].toLowerCase().includes("workshop")) {
        const candidatePaperEntityDraft = new PaperEntity();
        candidatePaperEntityDraft.publication = JSON.stringify({
          venue: bibtex[0]["container-title"],
          url: venueID.toLowerCase(),
        });
        candidatePaperEntityDraft.pubType = 1;
        candidatePaperEntityDrafts = [candidatePaperEntityDraft];
      }
    } catch (e) {
      console.log(e);
    }

    return candidatePaperEntityDrafts;
  }

  static matchingProcessVenue(
    paperEntityDraft: PaperEntity,
    candidatePaperEntityDrafts: PaperEntity[],
    venueID: string,
  ): PaperEntity {
    for (const candidatePaperEntityDraft of candidatePaperEntityDrafts) {
      const venueInfo = JSON.parse(candidatePaperEntityDraft.publication);
      if (venueInfo["url"].includes(venueID.toLowerCase())) {
        const venue = venueInfo["venue"];
        paperEntityDraft.publication = venue;
        break;
      }
    }
    return paperEntityDraft;
  }


  static async scrape(paperEntityDraft: PaperEntity): Promise<PaperEntity> {
    if (!this.checkEnable(paperEntityDraft)) {
      return paperEntityDraft;
    }
    const { scrapeURL, headers, venueID } = this.preProcessVenue(paperEntityDraft);

    const [apiURL, bibURL] = scrapeURL.split("|");

    // Initial request
    const [apiResponse, bibResponse] = await Promise.all([
      DBLPScraper._scrapeRequest(apiURL, headers),
      DBLPScraper._scrapeRequest(bibURL, headers),
    ]);

    let candidatePaperEntityDrafts = this.parsingProcessVenue(
      {
        apiResponse: apiResponse.body,
        bibResponse: bibResponse.body,
      },
      venueID,
    );

    let updatedPaperEntityDraft = this.matchingProcessVenue(
      paperEntityDraft,
      candidatePaperEntityDrafts,
      venueID,
    );

    if (updatedPaperEntityDraft.publication.startsWith("dblp://")) {
      updatedPaperEntityDraft.publication = "";
    }

    return updatedPaperEntityDraft;
  }
}
