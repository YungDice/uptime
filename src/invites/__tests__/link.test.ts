import { describe, expect, it } from "vitest";
import { appLink, inviteCodeIn, inviteLink } from "../link";

describe("invite links", () => {
  it("builds the page link a friend opens", () => {
    expect(inviteLink("0a1b2c3d4e5f", "dice")).toBe(
      "https://uptime-5jf.pages.dev/add/?c=0a1b2c3d4e5f&n=dice",
    );
  });

  it("builds the link that opens the app itself", () => {
    expect(appLink("0a1b2c3d4e5f")).toBe("uptime://add/0a1b2c3d4e5f");
  });

  it.each([
    ["the page link", "https://uptime-5jf.pages.dev/add/?c=0a1b2c3d4e5f&n=dice"],
    ["the page link without its slash", "https://uptime-5jf.pages.dev/add?c=0A1B2C3D4E5F"],
    ["the app link", "uptime://add/0a1b2c3d4e5f"],
    ["the app link with a trailing slash", "uptime://add/0a1b2c3d4e5f/"],
    ["a link pasted inside a message", "join me on uptime https://uptime-5jf.pages.dev/add/?c=0a1b2c3d4e5f !"],
  ])("finds the code in %s", (_what, text) => {
    expect(inviteCodeIn(text)).toBe("0a1b2c3d4e5f");
  });

  it.each([
    ["a nickname", "dice"],
    ["a bare code, which could just as well be a nickname", "0a1b2c3d4e5f"],
    ["another app's link", "https://example.com/?c=0a1b2c3d4e5f"],
    ["the check-in link", "uptime://check-in"],
    ["a code with nothing in it", "https://uptime-5jf.pages.dev/add/?c="],
  ])("finds nothing in %s", (_what, text) => {
    expect(inviteCodeIn(text)).toBeNull();
  });
});
