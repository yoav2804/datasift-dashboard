export default function Nav({ on }: { on: string }) {
  const items = [["/", "Calendar"], ["/upload", "Upload"], ["/review", "Review"], ["/tracker", "Tracker"]];
  return (<header><div className="brand">DataSift Ops <span>· St. Louis City pilot</span></div>
    <nav>{items.map(([h, l]) => <a key={h} href={h} className={on === l ? "on" : ""}>{l}</a>)}</nav></header>);
}
