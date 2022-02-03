import { Navigate } from "react-router";
import spotify, { useAuth } from "../util/spotify";
import "./Landing.scss";
import {Popup} from "../components/Popup";
import {useState} from "react";

export default function LandingPage() {
	const [popup, openPopup] = useState(false);
	const access_token = useAuth();
	//console.log({ access_token });
	if (access_token) return <Navigate to="/overview"/>;

	return (
		<div className="page landing">
			<h1 className="h1">Playlist Sorter 'n' Cleaner</h1>
			<a
				className="button dark large"
				href={spotify.createAuthorizeURL(
					["user-read-private", "playlist-read-private", "playlist-modify-public", "playlist-modify-private"],
					""
				)}
			>
				Login with Spotify
			</a>

			<div className="container">
				<br />
				<h2>👉 Get started 👈</h2>
				<ul>
					<li>Click on a playlist (and wait for it to load) to sort or clean it.</li>
					<li>Or drag and drop it to a special area and adjust the order to clean several at once.</li>
				</ul>
				<br />
				<h2>🎵 Features 🎵</h2>
				<ul>
					<li>Sort your playlists by genre and further divide them into separate playlists</li>
					<li>Clean from duplicated and unavailable tracks</li>
				</ul>
				<br />
				<h2>🙁 Known Limitations 🙁</h2>
				<ul>
					<li>Need to wait for the playlist to fully load</li>
					<li>Unable to find unavailable local tracks because the Spotify Web API can't</li>
					<li>Track genres are taken from artist genres (via the Spotify and Last.fm APIs), so they are not always relevant</li>
				</ul>
			</div>

			<div className="bottomright">
				<a href="/" onClick={(e) => {
					e.preventDefault();
					openPopup(true);
				}}> v0.5.3 </a>
			</div>

			<Popup open={popup} setOpen={openPopup}>
				<div className="container">
					<br />
					<h2>⚙ Changelog ⚙</h2>
					<ul>
						<li>0.3 — Deduper and cleaner.</li>
						<li>0.4 — Drag & Drop area. Updating React Components. Better UI.</li>
						<li>0.5 — Last.fm added as tag source</li>
						<li>0.5.3 — Basic mobile touch support. Tracks toggling. Bug fixes.
						</li>
					</ul>
				</div>
			</Popup>
		</div>
	);
}
