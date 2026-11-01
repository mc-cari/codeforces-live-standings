---
name: Collection admin
description: Minimal operational controls for Codeforces Live Standings collection.
colors:
  ink: "#1c302a"
  muted: "#53685f"
  green: "#176442"
  error: "#a52d29"
  line: "#d4ded7"
  background: "#f5f7f4"
  control: "#ffffff"
  selection: "#c8e8d5"
typography:
  body:
    fontFamily: "'Segoe UI', system-ui, sans-serif"
    lineHeight: 1.5
  title:
    fontSize: "2rem"
    fontWeight: 650
    letterSpacing: "-0.025em"
  section:
    fontSize: "1.4rem"
    fontWeight: 650
  table:
    fontSize: "0.9rem"
rounded:
  control: "6px"
components:
  save:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.control}"
    rounded: "{rounded.control}"
    padding: "0.75rem 1.1rem"
  save-hover:
    backgroundColor: "{colors.green}"
  select:
    backgroundColor: "{colors.control}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "0.7rem 2.5rem 0.7rem 0.8rem"
---

# Design System: Collection admin

## Overview

This document records the shipped, independent Astro admin in `admin/src`. It applies only to this operational surface. The visual language is quiet and compact: muted green surroundings, dark ink, native form controls, explicit status text, and simple rules between content areas.

## Colors

Green accents identify live collection, successful saves, checkbox selection, keyboard focus, and the Refresh status action. Ink carries primary text and the Save button; muted text carries help, freshness details, and column labels. Error text uses the error token. A pale background and subtle line token organize the page, with white reserved for controls.

**The Text Status Rule.** State remains legible in words: freshness, collection state, save results, and errors never rely on color alone.

## Typography

Use the system font stack throughout; no web fonts or imagery are required. Body size inherits the browser default. The page title uses the title token, the form legend uses the section token, and the contests heading is (1.2rem). Labels and status emphasis use weight (600); table headers use (0.8rem), supporting table text uses (0.9rem), and the footnote uses (0.85rem). Supporting details sit beneath their associated value.

## Layout

One centered column has a maximum width of (1080px), including desktop padding of (3rem 2rem). The page flows from title and identity, to collector status and refresh, to settings and contests, to the single Save action and its feedback. Header and save footer use thin dividing rules. Space between status and form, and between mode help and contests, is (2.5rem).

Above (600px), contests use a full-width four-column table: Collect, Contest, Start / phase, Collection. Rows align content at the top and use bottom borders; the contest name column has a minimum width of (190px). The table wrapper allows horizontal overflow.

At widths of (600px) or below, page padding becomes (1.5rem 1rem) and the title becomes (1.7rem). Each contest becomes a stacked grid row: a (2rem) checkbox column beside flexible contest details. Visible labels identify Start / phase and Collection; long text wraps. Empty rows span the grid. The save footer stacks its action and feedback vertically.

## Elevation & Depth

The interface is flat. Borders, whitespace, and type hierarchy separate content; there are no cards, shadows, floating panels, or decorative depth effects.

## Shapes

Select and Save controls have modest rounded corners using the control radius. Checkboxes and the select remain native controls. Table and section separators are straight (1px) rules. There is no icon system or ornamental shape language.

## Components

- **Mode control:** A labeled native select offers Off, Selected contests, and All public contests. Help explains that Off starts no new sessions while existing sessions continue. Contest selections are retained across modes.
- **Contest selection:** Native checkboxes have a green accent and a (1.15rem) square size. Each has an accessible name including its contest. A selected-count label stays beside the Contests heading. Rows show phase, collection state, last successful poll, and any error; missing timestamps read “Not yet.” Retained selections absent from discovery remain visible.
- **Save and feedback:** One Save settings button commits changes. It is disabled before settings load, when unchanged, and while saving; disabled opacity is (0.5). Enabled hover turns green. During saving, controls disable, the button reads “Saving…”, and a polite status message reports progress. Success is green; failure is red and retains the current edits for retry. Unsaved edits are retained in page state during refresh, with a navigation warning; they are not durable browser storage.
- **Collector status:** Discovery freshness and last success, capacity usage and waiting count, and discovery errors appear above the form. Status refreshes every (15 seconds) and through an underlined Refresh status button. Errors give a retry instruction. Loading and empty-table messages remain plain text in the table area.
- **Accessibility:** Semantic headings, fieldset and legend, associated labels, column scopes, and a visually hidden table caption structure the content. Save feedback uses a polite live status region; discovery errors use an alert. Keyboard focus has a green (3px) outline with (3px) offset, and a focused contest checkbox is restored after status rerendering.

## Do's and Don'ts

- Keep operational state, freshness, and errors visible as text.
- Preserve native controls, keyboard focus, the single Save action, and the stacked mobile rows.
- Keep this admin's visual rules scoped to `admin`; the existing standings frontend is independent.
- Do not add cards, shadows, decorative illustrations, custom fonts, or additional navigation to this minimal surface.
