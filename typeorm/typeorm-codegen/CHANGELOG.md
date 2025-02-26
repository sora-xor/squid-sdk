# Change Log - @subsquid/typeorm-codegen

This log was last generated on Mon, 01 May 2023 18:57:46 GMT and should not be manually modified.

## 1.0.0
Mon, 01 May 2023 18:57:46 GMT

### Breaking changes

- Introduce ArrowSquid

## 0.3.3
Sun, 12 Feb 2023 12:16:19 GMT

### Patches

- don't forget to import `@Index` directive for multi-column indexes (closes #157)

## 0.3.2
Thu, 09 Feb 2023 15:10:00 GMT

### Patches

- upgrade dependencies

## 0.3.1
Wed, 30 Nov 2022 19:36:06 GMT

### Patches

- remove lookup fields from generated entities (bi-directional `@OneToOne` relations are not yet supported)

## 0.3.0
Sun, 27 Nov 2022 18:43:31 GMT

### Minor changes

- explicitly fail codegen on native big number arrays

### Patches

- remove not needed `typeorm-config` dependency

## 0.2.3
Sun, 06 Nov 2022 18:24:20 GMT

### Patches

- always accept null column values to workaround TypeORM issue - field transformation can be run for a null entity

## 0.2.2
Fri, 28 Oct 2022 12:04:58 GMT

_Version update only_

## 0.2.1
Thu, 22 Sep 2022 19:06:43 GMT

### Patches

- remove unneeded `big-decimal` dependency

## 0.2.0
Thu, 22 Sep 2022 15:21:10 GMT

### Minor changes

- support `BigDecimal` type

## 0.1.2
Thu, 15 Sep 2022 20:54:52 GMT

### Patches

- adapt for new openreader upgrade

## 0.1.1
Wed, 17 Aug 2022 17:33:52 GMT

### Patches

- adapt for new openreader

## 0.1.0
Thu, 07 Jul 2022 15:00:50 GMT

### Minor changes

- make entity references always nullable in the database

## 0.0.3
Wed, 06 Jul 2022 09:25:54 GMT

### Patches

- add Readme

## 0.0.2
Fri, 24 Jun 2022 22:07:05 GMT

### Patches

- upgrade dependencies
- fix enum in typed json object issue

## 0.0.1
Thu, 23 Jun 2022 16:29:54 GMT

### Patches

- add missing shebang

## 0.0.0
Wed, 22 Jun 2022 13:18:45 GMT

_Initial release_

