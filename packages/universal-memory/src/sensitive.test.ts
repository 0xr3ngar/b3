import { describe, expect, it } from "@effect/vitest";

import { classifySensitive, redactSecrets } from "./sensitive.ts";

describe("classifySensitive", () => {
  it("blocks SSNs in common formats", () => {
    expect(classifySensitive("My SSN is 123-45-6789.")).toEqual({
      blocked: true,
      reason: "US Social Security number",
    });
    expect(classifySensitive("social security number 123 45 6789")).toEqual({
      blocked: true,
      reason: "US Social Security number",
    });
    expect(classifySensitive("my ssn is 123456789")).toEqual({
      blocked: true,
      reason: "US Social Security number",
    });
  });

  it("blocks formatted SSNs anywhere and bare 9-digit runs only near SSN keywords", () => {
    expect(classifySensitive("random note 123-45-6789")).toEqual({
      blocked: true,
      reason: "US Social Security number",
    });
    expect(classifySensitive("the echo showed 123456789 twice")).toEqual({ blocked: false });
    expect(classifySensitive("my ssn 721456789 is on file")).toEqual({
      blocked: true,
      reason: "US Social Security number",
    });
  });

  it("blocks passport and national ID numbers only near ID keywords", () => {
    expect(classifySensitive("my passport number is 1234 567 890")).toEqual({
      blocked: true,
      reason: "passport or national ID number",
    });
    expect(classifySensitive("the tracking number is 1234 567 890")).toEqual({ blocked: false });
    expect(classifySensitive("1234 567 890")).toEqual({ blocked: false });
  });

  it("blocks credit cards via Luhn and rejects failures", () => {
    expect(classifySensitive("my card is 4111 1111 1111 1111")).toEqual({
      blocked: true,
      reason: "credit card number",
    });
    expect(classifySensitive("card 4111-1111-1111-1112")).toEqual({ blocked: false });
    expect(classifySensitive("5555555555554444 worked")).toEqual({
      blocked: true,
      reason: "credit card number",
    });
  });

  it("blocks IBANs", () => {
    expect(classifySensitive("send it to DE89 3704 0044 0532 0130 00")).toEqual({
      blocked: true,
      reason: "IBAN",
    });
  });

  it("blocks known API key shapes", () => {
    const key = "sk-abcdefghijklmnopqrstuvwxyz012345";
    expect(classifySensitive(`use this key ${key}`)).toEqual({
      blocked: true,
      reason: "API key or token",
    });
    expect(classifySensitive("token ghp_abcdefghijklmnopqrstuvwxyz012345")).toEqual({
      blocked: true,
      reason: "API key or token",
    });
    expect(classifySensitive("aws key AKIAIOSFODNN7EXAMPLE")).toEqual({
      blocked: true,
      reason: "API key or token",
    });
    expect(classifySensitive("slack token xoxb-123456789012-abcdef")).toEqual({
      blocked: true,
      reason: "API key or token",
    });
  });

  it("blocks high-entropy tokens only near key/token/secret words", () => {
    const token = "Zx9kQ2vLm4Np7Rt8Wy3Bc6Fh1Jd5Gs0Va";
    expect(classifySensitive(`the api secret is ${token}`)).toEqual({
      blocked: true,
      reason: "API key or token",
    });
    expect(classifySensitive(`a random string ${token} in the notes`)).toEqual({ blocked: false });
  });

  it("blocks passwords", () => {
    expect(classifySensitive("my password is hunter2")).toEqual({
      blocked: true,
      reason: "password",
    });
    expect(classifySensitive('the wifi password: "correct horse"')).toEqual({
      blocked: true,
      reason: "password",
    });
  });

  it("blocks criminal history and immigration status", () => {
    expect(classifySensitive("I was convicted of a felony in 2019")).toEqual({
      blocked: true,
      reason: "criminal history",
    });
    expect(classifySensitive("my green card application is pending")).toEqual({
      blocked: true,
      reason: "immigration status",
    });
  });

  it("flags opt-in categories without blocking", () => {
    expect(classifySensitive("I was diagnosed with asthma last year")).toEqual({
      blocked: false,
      optInCategory: "health",
    });
    expect(classifySensitive("I go to church on Sundays")).toEqual({
      blocked: false,
      optInCategory: "religion",
    });
    expect(classifySensitive("I am a democrat")).toEqual({
      blocked: false,
      optInCategory: "politics",
    });
    expect(classifySensitive("I am bisexual")).toEqual({
      blocked: false,
      optInCategory: "sexuality",
    });
    expect(classifySensitive("I identify as nonbinary")).toEqual({
      blocked: false,
      optInCategory: "gender_identity",
    });
  });

  it("leaves everyday text alone", () => {
    expect(classifySensitive("I prefer dark mode and drink too much coffee")).toEqual({
      blocked: false,
    });
    expect(classifySensitive("Let's meet at 5pm near the station")).toEqual({ blocked: false });
  });
});

describe("redactSecrets", () => {
  it("replaces secret spans and keeps the rest", () => {
    expect(redactSecrets("my password is hunter2 ok")).toBe("my password is [redacted] ok");
    expect(redactSecrets("card 4111 1111 1111 1111 thanks")).toBe("card [redacted] thanks");
    expect(redactSecrets("key sk-abcdefghijklmnopqrstuvwxyz012345 done")).toBe(
      "key [redacted] done",
    );
  });

  it("handles several secrets and overlapping spans", () => {
    const redacted = redactSecrets("ssn 123-45-6789 and password is hunter2");
    expect(redacted).toContain("[redacted]");
    expect(redacted).not.toContain("123-45-6789");
    expect(redacted).not.toContain("hunter2");
  });

  it("leaves clean text unchanged", () => {
    expect(redactSecrets("nothing sensitive here")).toBe("nothing sensitive here");
  });
});
