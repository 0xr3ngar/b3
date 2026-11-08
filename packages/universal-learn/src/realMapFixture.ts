import type { TransitInput } from "./transit.ts";

export const realMap: TransitInput = {
  lines: [
    {
      id: "probability",
      title: "Probability",
    },
    {
      id: "rust",
      title: "Rust",
    },
  ],
  stations: [
    {
      id: "bayes-rule",
      title: "bayes rule",
      lineIds: [],
      state: "ready",
    },
    {
      id: "bayes.likelihood",
      title: "bayes.likelihood",
      lineIds: [],
      state: "ready",
    },
    {
      id: "bayes.prior",
      title: "bayes.prior",
      lineIds: [],
      state: "ready",
    },
    {
      id: "prob-basics",
      title: "Probability basics",
      lineIds: ["probability"],
      state: "ready",
    },
    {
      id: "prob-conditional",
      title: "Conditional probability",
      lineIds: ["probability"],
      state: "ready",
    },
    {
      id: "prob-random-variables",
      title: "Random variables",
      lineIds: ["probability"],
      state: "ready",
    },
    {
      id: "prob-expectation",
      title: "Expectation",
      lineIds: ["probability"],
      state: "ready",
    },
    {
      id: "prob-likelihood",
      title: "Likelihood",
      lineIds: ["probability"],
      state: "ready",
    },
    {
      id: "prob-priors",
      title: "Priors",
      lineIds: ["probability"],
      state: "ready",
    },
    {
      id: "prob-bayes",
      title: "Bayes' rule",
      lineIds: ["probability"],
      state: "ready",
    },
    {
      id: "prob-conjugate",
      title: "Conjugate priors",
      lineIds: ["probability"],
      state: "ready",
    },
    {
      id: "prob-posterior-predictive",
      title: "Posterior predictive",
      lineIds: ["probability"],
      state: "ready",
    },
    {
      id: "rust-ownership",
      title: "Ownership",
      lineIds: ["rust"],
      state: "ready",
    },
    {
      id: "rust-borrowing",
      title: "Borrowing",
      lineIds: ["rust"],
      state: "ready",
    },
    {
      id: "rust-lifetimes",
      title: "Lifetimes",
      lineIds: ["rust"],
      state: "ready",
    },
    {
      id: "rust-generics",
      title: "Generics",
      lineIds: ["rust"],
      state: "ready",
    },
    {
      id: "rust-traits",
      title: "Traits",
      lineIds: ["rust"],
      state: "ready",
    },
    {
      id: "spanish-beginner",
      title: "Spanish (beginner)",
      lineIds: [],
      state: "suggested",
    },
  ],
  edges: [
    {
      from: "prob-basics",
      to: "prob-conditional",
    },
    {
      from: "prob-basics",
      to: "prob-random-variables",
    },
    {
      from: "prob-bayes",
      to: "prob-conjugate",
    },
    {
      from: "prob-conditional",
      to: "prob-bayes",
    },
    {
      from: "prob-conjugate",
      to: "prob-posterior-predictive",
    },
    {
      from: "prob-expectation",
      to: "prob-conjugate",
    },
    {
      from: "prob-likelihood",
      to: "prob-bayes",
    },
    {
      from: "prob-priors",
      to: "prob-bayes",
    },
    {
      from: "prob-random-variables",
      to: "prob-expectation",
    },
    {
      from: "rust-borrowing",
      to: "rust-lifetimes",
    },
    {
      from: "rust-generics",
      to: "rust-traits",
    },
    {
      from: "rust-lifetimes",
      to: "rust-generics",
    },
    {
      from: "rust-ownership",
      to: "rust-borrowing",
    },
  ],
};
