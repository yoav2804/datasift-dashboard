export default function Nav({ on }: { on: string }) {
  const items = [["/", "Calendar"], ["/lists", "List Log"], ["/upload", "Upload"], ["/review", "Review"], ["/tracker", "Tracker"]];
  return (<header><div className="brand">DataSift Ops <span>· St. Louis City + County</span></div>
    <nav>{items.map(([h, l]) => <a key={h} href={h} className={on === l ? "on" : ""}>{l}</a>)}</nav></header>);
}
