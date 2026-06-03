-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Match" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "fixtureId" TEXT NOT NULL,
    "homeTeam" TEXT NOT NULL,
    "awayTeam" TEXT NOT NULL,
    "league" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "matchDate" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'NS',
    "homeGoals" INTEGER,
    "awayGoals" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Match" ("awayGoals", "awayTeam", "country", "createdAt", "fixtureId", "homeGoals", "homeTeam", "id", "league", "matchDate", "status", "updatedAt") SELECT "awayGoals", "awayTeam", "country", "createdAt", "fixtureId", "homeGoals", "homeTeam", "id", "league", "matchDate", "status", "updatedAt" FROM "Match";
DROP TABLE "Match";
ALTER TABLE "new_Match" RENAME TO "Match";
CREATE UNIQUE INDEX "Match_fixtureId_key" ON "Match"("fixtureId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
