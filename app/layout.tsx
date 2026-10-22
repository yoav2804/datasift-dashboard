import "./globals.css";
export const metadata = { title: "DataSift Ops", description: "Pull Calendar, Data Manager and Tracker for TJ INVEST" };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (<html lang="en"><body><div className="wrap">{children}</div></body></html>);
}
