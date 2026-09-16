# Data coverage

Built 2026-09-14 from the OpenHalalan `data-latest` release.

## Sources

- `NLE_Winners_2004-2025.csv`: every local winner 2001-2025 (names, party, sex, no votes).
- `NLE_Vote_Counts_2007-2025.csv.gz`: every candidate with votes, usable from 2010. Province-level races are reported per city and summed here; national races are summed per province.

## Per election

| Year | Winners | Candidacies | Contests | Towns | Winners linked to a vote row | Unlinked winners | Winners inferred from votes | Vote-only candidates |
|---|---|---|---|---|---|---|---|---|
| 2001 | 17,490 | 17,490 | 5,126 | 1,605 | 0 (0%) | 17,490 | 0 | 0 |
| 2004 | 17,368 | 17,368 | 5,090 | 1,596 | 0 (0%) | 17,368 | 0 | 0 |
| 2007 | 16,608 | 16,608 | 4,886 | 1,515 | 0 (0%) | 16,608 | 0 | 0 |
| 2010 | 17,967 | 37,029 | 5,393 | 1,614 | 9,919 (55%) | 7,583 | 465 | 19,062 |
| 2013 | 20,018 | 45,054 | 5,876 | 1,686 | 12,363 (62%) | 4,798 | 2,857 | 25,036 |
| 2016 | 17,783 | 44,708 | 5,571 | 1,633 | 17,760 (100%) | 0 | 23 | 26,925 |
| 2019 | 17,840 | 43,563 | 5,568 | 1,634 | 17,781 (100%) | 0 | 59 | 25,723 |
| 2022 | 17,828 | 46,163 | 5,580 | 1,634 | 17,803 (100%) | 1 | 24 | 28,335 |
| 2025 | 17,831 | 41,257 | 5,628 | 1,637 | 17,806 (100%) | 1 | 24 | 23,426 |

Linked = the winner was found among that contest's vote rows (exact name, unique surname, or first-name prefix). Unlinked winners keep their seat but have no vote count. Inferred = the winners file has no row for the contest, so the top candidates by votes are marked as winners using the seat count seen in other years. Before 2010 no vote data exists.

## Persons

175,720 persons from 309,240 candidacies. How each candidacy after a person's first was attached:

| Confidence | Candidacies | Rule |
|---|---|---|
| exact | 65,705 | same surname, first name and middle name in the same province |
| strong | 64,515 | same first name in a town already seen, or nickname/prefix with matching middle name |
| weak | 3,300 | nickname/prefix of first name in a town already seen |
| new | 175,720 | first candidacy of a person |

Repeat politicians (2+ candidacies): 65,877. Winners of 5+ elections: 4,098.

## Known gaps

- 2010 vote counts cover about two thirds of towns; 2013 about 90%. Missing towns still list winners, without votes.
- 2025 `rank` in the source is unreliable and is ignored; ranks here are recomputed from votes.
- Party list rows are organizations, not people, and are only shown as vote totals.
- Representatives and board members are elected per legislative district. From 2010 the vote file names the district and its towns, and a city with its own district (Cebu City, Quezon City, Mandaue) is treated as that city's contest. Before 2010 the winners file has no district, so a province's representatives sit in one district-less contest and the member towns are borrowed from the nearest later election.
- Two people with the same surname and first name in the same province but different towns are kept separate; nicknames that are not prefixes ("ATTING" for ROBERTO) create separate persons. See `match` on each candidacy.
