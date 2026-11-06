import LandingSection from "./landing-section";
import PublicDeck from "./public-deck";

const steps = [
  {
    title: "Start a conversation.",
    description: "Choose a model and explain what you want to work on.",
  },
  { title: "Bring the context.", description: "Add supported files or references when they help." },
  {
    title: "Review the result.",
    description: "Shape the draft, check the changes, and export your document.",
  },
];

export default function LandingWorkflow() {
  return (
    <LandingSection kind="workflow">
      <div className="section-heading">
        <div>
          <p className="eyebrow">
            <i /> 02 / HOW IT WORKS
          </p>
          <h2 id="workflow-heading" tabIndex={-1}>
            From first thought
            <br /> to a working draft.
          </h2>
        </div>
        <p className="intro">
          Bring your context.
          <br />
          Think with AI.
          <br />
          Keep the final say.
        </p>
      </div>
      <PublicDeck kind="workflow">
        {steps.map((step, index) => (
          <article className="step" key={step.title}>
            <span className="step-index">0{index + 1}</span>
            <h3>{step.title}</h3>
            <p>{step.description}</p>
          </article>
        ))}
      </PublicDeck>
    </LandingSection>
  );
}
