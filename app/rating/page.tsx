import { redirect } from "next/navigation";

// Dead placeholder retired -- the real rating screen has always lived at
// /leaderboard (see app/leaderboard/page.tsx). Redirect instead of
// maintaining two independent, inevitably-diverging rating UIs.
export default function RatingPage() {
  redirect("/leaderboard");
}
