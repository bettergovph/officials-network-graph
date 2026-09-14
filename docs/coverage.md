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
| 2010 | 17,965 | 37,029 | 5,370 | 1,614 | 9,919 (55%) | 7,583 | 463 | 19,064 |
| 2013 | 20,015 | 45,054 | 5,863 | 1,686 | 12,363 (62%) | 4,798 | 2,854 | 25,039 |
| 2016 | 17,760 | 44,708 | 5,548 | 1,633 | 17,760 (100%) | 0 | 0 | 26,948 |
| 2019 | 17,818 | 43,563 | 5,545 | 1,634 | 17,781 (100%) | 0 | 37 | 25,745 |
| 2022 | 17,804 | 46,163 | 5,554 | 1,634 | 17,803 (100%) | 1 | 0 | 28,359 |
| 2025 | 17,807 | 41,257 | 5,599 | 1,637 | 17,806 (100%) | 1 | 0 | 23,450 |

Linked = the winner was found among that contest's vote rows (exact name, unique surname, or first-name prefix). Unlinked winners keep their seat but have no vote count. Inferred = the winners file has no row for the contest, so the top candidates by votes are marked as winners using the seat count seen in other years. Before 2010 no vote data exists.

## Persons

175,714 persons from 309,240 candidacies. How each candidacy after a person's first was attached:

| Confidence | Candidacies | Rule |
|---|---|---|
| exact | 65,705 | same surname, first name and middle name in the same province |
| strong | 64,521 | same first name in a town already seen, or nickname/prefix with matching middle name |
| weak | 3,300 | nickname/prefix of first name in a town already seen |
| new | 175,714 | first candidacy of a person |

Repeat politicians (2+ candidacies): 65,880. Winners of 5+ elections: 4,093.

## Known gaps

- 2010 vote counts cover about two thirds of towns; 2013 about 90%. Missing towns still list winners, without votes.
- 2025 `rank` in the source is unreliable and is ignored; ranks here are recomputed from votes.
- Party list rows are organizations, not people, and are only shown as vote totals.
- Two people with the same surname and first name in the same province but different towns are kept separate; nicknames that are not prefixes ("ATTING" for ROBERTO) create separate persons. See `match` on each candidacy.
