import { CircleUser } from "lucide-react";

// A small profile icon immediately before a user/employee name. Used anywhere
// a person's name appears (headers, tables, dashboards, conversation).
export default function UserBadge({
  name,
  size = 16,
  strong = false,
}: {
  name: string;
  size?: number;
  strong?: boolean;
}) {
  return (
    <span className="userBadge">
      <CircleUser size={size} strokeWidth={1.75} className="userBadgeIcon" />
      <span className={strong ? "userBadgeName strong" : "userBadgeName"}>{name}</span>
    </span>
  );
}
