import LandingSection from "./landing-section";
import PublicDeck from "./public-deck";

const capabilities = [
  {
    label: "01 / CONVERSATIONS",
    title: "Chat with AI.",
    description: "Start a conversation. Return to it. Keep your ideas moving.",
  },
  {
    label: "02 / FILES",
    title: "Keep files close.",
    description: "Bring your working files into the conversation.",
  },
  {
    label: "03 / IMAGES",
    title: "Create images.",
    description: "Generate and reference images without leaving the conversation.",
  },
];

function CapabilityIcon({ index }: { index: number }) {
  return (
    <svg
      viewBox="0 0 120 120"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      aria-hidden="true"
    >
      {index === 0 ? (
        <>
          <rect x="18" y="22" width="84" height="63" rx="12" />
          <path d="M36 85v15l20-15M36 43h48M36 58h30" />
        </>
      ) : index === 1 ? (
        <>
          <path d="M17 35h34l10 12h42v47H17z" />
          <path d="M27 35V24h37l12 12h18v11M35 65h48M35 77h30" />
        </>
      ) : (
        <path d="M31 15h40l20 20v70H31zM71 15v22h20M45 56h32M45 70h32M45 84h20" />
      )}
    </svg>
  );
}

export default function LandingWorkspace() {
  return (
    <LandingSection kind="workspace">
      <div className="section-heading">
        <div>
          <p className="eyebrow">
            <i /> THE WORKSPACE
          </p>
          <h2 id="workspace-heading" tabIndex={-1}>
            One office.
            <br /> Three ways to work.
          </h2>
        </div>
        <p className="intro">
          AI conversations, working files,
          <br />
          and generated images.
          <br />
          All in one personal workspace.
        </p>
      </div>
      <PublicDeck kind="workspace">
        {capabilities.map((item, index) => (
          <article className={`pillar pillar-${index}`} key={item.label}>
            <span className="number">{item.label}</span>
            <div className="graphic">
              <CapabilityIcon index={index} />
            </div>
            <div className="words">
              <h3>{item.title}</h3>
              <p>{item.description}</p>
            </div>
          </article>
        ))}
      </PublicDeck>
    </LandingSection>
  );
}
