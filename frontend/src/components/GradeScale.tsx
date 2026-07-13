// A plain-language explanation of the CEFR grades used in assessments,
// so an admin (or anyone) can read a score without prior knowledge.
const GRADES: [string, string, string][] = [
  ["A1", "Beginner", "Uses a few basic words and memorised phrases; can barely hold a conversation."],
  ["A2", "Elementary", "Handles simple, routine exchanges on familiar topics like greetings and daily needs."],
  ["B1", "Intermediate", "Holds everyday conversations and describes experiences and opinions, with some errors."],
  ["B2", "Upper-Intermediate", "Converses fluently and in detail on most topics; errors rarely cause confusion."],
  ["C1", "Advanced", "Speaks fluently, precisely and flexibly, including complex or professional topics."],
  ["C2", "Proficient", "Speaks effortlessly and accurately — near-native command of the language."],
];

export default function GradeScale() {
  return (
    <div className="gradeScale">
      {GRADES.map(([g, title, desc]) => (
        <div className="gradeRow" key={g}>
          <span className={`gradeTag g${g}`}>{g}</span>
          <div className="gradeText">
            <b>{title}</b>
            <span className="gradeDesc"> — {desc}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
