# Security

Report vulnerabilities privately through GitHub: the repository's **Security** tab → **Report a vulnerability**. Please don't open a public issue.

Worth reporting: escaping the renderer sandbox, IPC that accepts a sender it shouldn't, navigation or downloads outside the rules, vault paths that escape their folder, leaked credentials, and anything that gets around the signed update notice.

Include the client version, your system, the steps, and what an attacker gains. Leave out tokens, cookies, account details and private screenshots.

Problems with the game itself, such as score verification or the website, go to the bunnyhop.lol staff privately, not here.

Only the latest release gets fixes. Development builds never check for updates; release builds accept only update notes signed with the release key ([releases](docs/releases.md)).
