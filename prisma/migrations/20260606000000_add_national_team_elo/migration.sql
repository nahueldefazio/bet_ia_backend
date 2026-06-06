-- CreateTable
CREATE TABLE `NationalTeamElo` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `teamName` VARCHAR(191) NOT NULL,
    `eloRating` INTEGER NOT NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `NationalTeamElo_teamName_key`(`teamName`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
