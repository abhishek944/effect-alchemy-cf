import SearchField from "./search-field";

export default function ChatSearch({
  value,
  onChange,
  matches,
}: {
  value: string;
  onChange: (value: string) => void;
  matches: number;
}) {
  return (
    <SearchField
      id="chat-search-input"
      label="Search saved chat titles"
      value={value}
      onChange={onChange}
      status={`${matches} matching ${matches === 1 ? "chat" : "chats"}`}
    />
  );
}
