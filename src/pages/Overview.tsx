import {useEffect, useReducer, useRef, useState} from 'react';
import spotify, {getAllUserPlaylists} from '../util/spotify';
import './Overview.scss';
import Playlist from '../components/Playlist';
import {millisToMinutesAndSeconds} from '../components/Playlist';
import {Popup} from "../components/Popup";
import 'missing-native-js-functions';

export default function OverviewPage() {
	const [playlists, setPlaylist] = useState<SpotifyApi.PlaylistObjectSimplified[]>([]);
	const [selectedPlaylist, selectPlaylist] = useState<string | null>(null);
	const [dedupPlaylists, setDedup] = useState<SpotifyApi.PlaylistObjectSimplified[]>([]);
	const [user, setUser] = useState<string>('');
	const [country, setCountry] = useState('');
	const [dedupMax, setDedupMax] = useState(0);
	const [dedupProgress, setDedupProgress] = useState(0);
	const [rndProgress, setRndProgress] = useState(0);
	const rndProgressMax = 1.25;
	const [popup, openPopup] = useState(false);
	const [popupRandomPlst, openPopupRandomPlst] = useState(false);
	const [selectedElnt, setSelectedElnt] = useState<HTMLDivElement | undefined>(undefined);
	const [deleteList, setDeleteList] = useState<trackInfo[]>([]);
	const [excludedTracks, setExcludedTracks] = useState<trackInfo[]>([]);
	const [, forceUpdate] = useReducer(x => x + 1, 0);
	const [randomPlaylistSize, setRandomPlaylistSize] = useState(1000);
	const [trackListSample, setTrackListSample] = useState<string[]>([]);

	var enterTarget: EventTarget | null = null;

	const playlistRef = useRef('');

	interface trackInfo {
		track: SpotifyApi.TrackObjectFull,
		index: number,
		playlist: SpotifyApi.SinglePlaylistResponse,
		original: string
	}


	useEffect(() => {
		//console.log('fetch playlists');
		spotify.getMe().then(async ({body: state}) => {
			setUser(state.id);
		});
		spotify.getMe().then(async ({body: state}) => {
			setCountry(state.country);
		});
		getAllUserPlaylists().then((x) => setPlaylist(x.items));

	}, []);


	enum ERemovalMode {
		Dedup,
		Unavailable,
		Search
	}

	async function removeTracks(mode: ERemovalMode) {
		if (!!dedupMax) return;
		if (mode === ERemovalMode.Search) {
			var query: string = prompt("Search by track or artist")?.toLowerCase() || '';
			if (!query) return;
		}

		setDedupProgress(0);
		setDedupMax(100);
		forceUpdate();

		let plstsResponse = [];
		let max = 0;
		let progress = 0;
		for (const plIt of dedupPlaylists) {
			const {body: plResponse} = (await spotify.getPlaylist(plIt.id, {market: country}));
			plstsResponse.push(plResponse);
			max += plResponse.tracks.total;
			progress += Math.min(plResponse.tracks.limit, plResponse.tracks.total);
		}
		setDedupMax(max);
		setDedupProgress(progress);

		let trackList: trackInfo[] = [];
		for (const plIt of plstsResponse) {
			while (plIt.tracks.offset + plIt.tracks.limit < plIt.tracks.total) {
				plIt.tracks.offset += plIt.tracks.limit;
				const {body: tracksResponse} = await spotify.getPlaylistTracks(plIt.id, {
					market: country,
					offset: plIt.tracks.offset
				});
				plIt.tracks.items = plIt.tracks.items.concat(tracksResponse.items);
				progress += Math.min(plIt.tracks.total - plIt.tracks.offset, plIt.tracks.limit);
				setDedupProgress(progress);
			} 

			for (let i = 0; i < plIt.tracks.items.length; i++) {
				if (plIt.tracks.items[i].track.type === 'track') {
					trackList.push({
						track: plIt.tracks.items[i].track,
						index: i,
						playlist: plIt,
						original: ''
					});
				}
			}
		}

		let str = '';
		switch (+mode) {
			case ERemovalMode.Dedup:
				str = 'duplicated';
				//search for duplicates and leave only them
				const trackUri = trackList.map((x) => x.track.uri);
				for (let i = 0; i < trackList.length; i++) {
					const indexOfTrack = trackUri.indexOf(trackList[i].track.uri);
					if (indexOfTrack !== i) {
						const orig = trackList[indexOfTrack];
						trackList[i].original = orig.playlist.name + ' #' + (orig.index + 1);
					}
				}
				trackList = trackList.filter((x) => !!x.original);
				break;
			case ERemovalMode.Unavailable:
				str = 'unplayable';
				//search for unavailable songs and leave only them
				trackList = trackList.filter((x) => x.track.is_playable === false);
				break;
			case ERemovalMode.Search:
				str = 'searched';
				//search for tracks and leave only them
				trackList = trackList.filter((x) =>
					x.track.name.toLowerCase().includes(query)
					|| x.track.artists.find((y: any) => y.name.toLowerCase().includes(query)));
				break;
			default:
				setDedupMax(0);
				return;
		}
		if (mode !== ERemovalMode.Search) {
			trackList = trackList.filter((x) => x.playlist.owner.id === user || x.playlist.collaborative);
		}

		setDedupProgress(max);
		forceUpdate();

		if (trackList.length) {
			setDeleteList(trackList);
			openPopup(true);
		} else {
			alert('No ' + str + ' tracks!');
		}
		setDedupMax(0);
	}

	async function confirmRemoval() {
		let trackList = deleteList
			.filter((x) => x.playlist.owner.id === user || x.playlist.collaborative)
			.filter((x) => !excludedTracks.includes(x));

		while (trackList.length) {
			let curPlaylist = trackList[0].playlist;
			let curTrackList = trackList
				.filter((x) => x.playlist === curPlaylist)
				.sort((x, y) => y.index - x.index);
			const list = (await spotify.getPlaylist(curPlaylist.id)).body;
			while (curTrackList.length) {
				const batch = curTrackList.slice(0, 100).map((x) => x.index);
				curTrackList = curTrackList.slice(100);
				await spotify.removeTracksFromPlaylistByPosition(list.id, batch, list.snapshot_id);
				batch.forEach((x) => curPlaylist.tracks.items.splice(x, 1));
			}
			trackList = trackList.filter((x) => x.playlist !== curPlaylist);
		}
		setDeleteList([]);
		openPopup(false);
	}

	async function createRandomPlaylist() {
		if (rndProgress > 0 && rndProgress < rndProgressMax) return;
		setRndProgress(0.0001);
		forceUpdate();

		let trackList: string[] = [];
		if (trackListSample.length) {
			trackList = trackListSample;
			setRndProgress(1);
		} else {
			let plstsResponse = [];
			let max = 0;
			let progress = 0;
			for (const plIt of dedupPlaylists) {
				const {body: plResponse} = (await spotify.getPlaylist(plIt.id, {market: country}));
				plstsResponse.push(plResponse);
				max += plResponse.tracks.total;
				progress += Math.min(plResponse.tracks.limit, plResponse.tracks.total);
			}
			setRndProgress(progress/max);
			for (const plIt of plstsResponse) {
				while (plIt.tracks.offset + plIt.tracks.limit < plIt.tracks.total) {
					plIt.tracks.offset += plIt.tracks.limit;
					const {body: tracksResponse} = await spotify.getPlaylistTracks(plIt.id, {
						market: country,
						offset: plIt.tracks.offset
					});
					plIt.tracks.items = plIt.tracks.items.concat(tracksResponse.items);
					const delta = plIt.tracks.total - plIt.tracks.offset;
					progress += Math.min(delta > 0 ? delta : plIt.tracks.total, plIt.tracks.limit);
					setRndProgress(progress / max);
				}

				for (let i = 0; i < plIt.tracks.items.length; i++) {
					if (plIt.tracks.items[i].track.type === 'track') {
						trackList.push(plIt.tracks.items[i].track.uri);
					}
				}
			}
			setTrackListSample(trackList);
		}

		let number = Math.min(trackList.length, randomPlaylistSize);

		if (number >= 1) {
			const dateUTC = new Date();
			const date = new Date(dateUTC.getTime() - dateUTC.getTimezoneOffset()*60*1000);
			const newPlaylist = (await spotify.createPlaylist('Random ' + date.toISOString().slice(0, -5), {public: false})).body;

			if (newPlaylist) {
				let batch: string[];
				let counter = 0;
				do {
					batch = [];
					do {
						const index = Math.randomIntBetween(0, trackList.length - 1);
						batch.push(trackList[index]);
						trackList.splice(index, 1);
					} while (++counter % 100 && counter < number);
					await spotify.addTracksToPlaylist(newPlaylist.id, batch);
					setRndProgress(counter / number + 1);
				} while (counter < number);
				setRndProgress(rndProgressMax);
				forceUpdate();
			}
		}
	}

	function cleanDedupList() {
		setDedup([]);
	}

	function toggleTrackDeletion(track: trackInfo) {
		let list = [...excludedTracks];

		if (list.includes(track))
			list = list.filter((x) => x !== track)
		else list.push(track);

		setExcludedTracks(list);
	}

	function selectPlaylistHelper(id: string) {
		selectPlaylist(id);
		playlistRef.current = id;
	}

	/*Drag & Drop*/

	const entryDragStartHandler = function (e: any) {
		setSelectedElnt(e.target);
	}

	const dropHandler = function (e: any) {
		e.preventDefault();
		setSelectedElnt(undefined);
		enterTarget = null;
	}

	const dragEnterHandler = function (e: any) {
		e.preventDefault();
		if (e.target.className === 'playlistsDedup' && enterTarget === null) dragEntry('');
		enterTarget = e.target;
	}

	const dragLeaveHandler = function (e: any) {
		if (enterTarget === e.target && selectedElnt) {
			const tempArray = dedupPlaylists.filter((x) => x.id !== selectedElnt.dataset.playlist);
			setDedup(tempArray);
			enterTarget = null;
		}
	}

	function dragEntry(hoveredPl: string) {
		if (!selectedElnt || selectedElnt.dataset.playlist === hoveredPl) return;

		const selectedPl = playlists.find((x) => x.id === selectedElnt.dataset.playlist);
		if (selectedPl /*&& (selectedPl.owner.id === user || selectedPl.collaborative)*/) {
			let elntHoveredIndex = dedupPlaylists.length;
			if (hoveredPl) {
				elntHoveredIndex = dedupPlaylists.findIndex((x) => x.id === hoveredPl);
				if (elntHoveredIndex < 0) elntHoveredIndex = dedupPlaylists.length;
			}

			let tempDedupPlaylists = [...dedupPlaylists];
			const elntOldIndex = dedupPlaylists.indexOf(selectedPl);
			tempDedupPlaylists.splice(elntHoveredIndex, 0, (elntOldIndex > -1)
				? tempDedupPlaylists.splice(elntOldIndex, 1)[0]
				: selectedPl);

			setDedup(tempDedupPlaylists);
		}

	}

	/*Touch events*/

	const entryTouchStartHandler = function (e: any) {
		// e.preventDefault();
		setSelectedElnt(e.target);
		const clone = e.target.cloneNode(true);
		if (clone?.style) {
			clone.className = 'touchedEntry';
			clone.id = 'touchedItem'
			entryTouchMoveHandler(e)
			document.body.appendChild(clone);
		}
	}

	const entryTouchMoveHandler = function (e: any) {
		const clone = document.getElementById('touchedItem');
		if (clone?.style) {
			const touchLocation = e.targetTouches[0];
			clone.style.left = touchLocation.pageX + 'px';
			clone.style.top = touchLocation.pageY + 'px';
		}
	}

	const entryTouchEndHandler = function (e: any) {
		const clone = document.getElementById('touchedItem');
		if (clone) {
			const playlistsDedup = document.getElementsByClassName('playlistsDedup')[0];
			if (selectedElnt && playlistsDedup) {
				const touchLocation = e.changedTouches[0];
				const rect = playlistsDedup.getBoundingClientRect();
				const x = touchLocation.clientX;
				const y = touchLocation.clientY;
				if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
					const selectedPl = playlists.find((x) => x.id === selectedElnt.dataset.playlist);
					if (selectedPl) {
						let elntHoveredIndex = dedupPlaylists.length;

						let tempDedupPlaylists = [...dedupPlaylists];
						const elntOldIndex = dedupPlaylists.indexOf(selectedPl);
						tempDedupPlaylists.splice(elntHoveredIndex, 0, (elntOldIndex > -1)
							? tempDedupPlaylists.splice(elntOldIndex, 1)[0]
							: selectedPl);

						setDedup(tempDedupPlaylists);
					}
				}
			}
			document.body.removeChild(clone);
		}
	}

	const entryTouchCancelHandler = function () {
		const clone = document.getElementById('touchedItem');
		if (clone) document.body.removeChild(clone);
	}
	/********************************************************************************************/

	return (
		<div className="page overview">
			<img width="110vw" src="https://storage.googleapis.com/pr-newsroom-wp/1/2018/11/Spotify_Logo_RGB_White.png"
			     alt=""/>

			<div className="playlist">
				<Popup open={popup} setOpen={openPopup}>
					<h1 style={{fontSize: "2rem"}}>Delete List (click for toggle)</h1>
					<div>
						<button className="button dark" style={{padding: "0.5rem"}} onClick={() => confirmRemoval()}>
							Remove
						</button>
						<button className="button light" style={{padding: "0.5rem", marginLeft: "20px"}}
						        onClick={() => {
							        setDeleteList([]);
							        openPopup(false)
						        }}>
							Cancel
						</button>
					</div>


					<table className="tracks" width={deleteList.length && deleteList[0].original ? "70%" : "60%"}>
						<thead className="heading">
						<tr>
							<th className="playlistName">Playlist</th>
							<th className="number">#</th>
							<th className="title">Song</th>
							<th className="artist">Artist</th>
							<th className="length">Length</th>
							{deleteList.length && deleteList[0].original ?
								<th className="original">Original</th> : null}
						</tr>
						</thead>
						<tbody>
						{deleteList.map((x, i) => (
							<tr
								className="track"
								key={x.playlist.id + x.track.id + x.index}
								{...(x.playlist.owner.id === user || x.playlist.collaborative) && {onClick: toggleTrackDeletion.bind(null, x)}}
								style={(x.playlist.owner.id === user || x.playlist.collaborative)
									? {cursor: "pointer"}
									: {color: "#B0B0B0"}}
							>
								<td className="playlistName">{i === 0 || x.playlist !== deleteList[i - 1].playlist ? x.playlist.name : null}</td>
								<td className="number">{x.index + 1}</td>
								<td className="title" style={excludedTracks.includes(x)
									? {textDecoration: "line-through", textDecorationThickness: "15%", color: "#B0B0B0"}
									: {}}>
									{x.track.name}</td>
								<td className="artist">
									{x.track.artists.map((y: any, j: number) =>
										<p key={x.track.id + i.toString() + y + j.toString()}>{y.name}</p>)
									}
								</td>
								<td className="length">{millisToMinutesAndSeconds(x.track.duration_ms)}</td>
								{deleteList[0].original
									? <td className="original">
										{x.original && (i === 0 || x.original !== deleteList[i - 1].original) ? x.original : null}
									</td>
									: null
								}
							</tr>
						))}
						</tbody>
					</table>
				</Popup>
			</div>

			<Popup open={popupRandomPlst} setOpen={openPopupRandomPlst}>
				<h1 style={{fontSize: "3rem"}}>Playlist of randomly selected tracks</h1>

				<label>
					<input
						type="number"
						min="1"
						max="10000"
						value={randomPlaylistSize}
						onChange={(e) => setRandomPlaylistSize(Number(e.target.value))}
					/>
					<br/>
					Size of playlist
				</label>

				<div>
					<button className="button dark" style={{padding: "0.5rem"}} onClick={() => createRandomPlaylist()}>
						Create
					</button>
					<button className="button light" style={{padding: "0.5rem", marginLeft: "20px"}}
					        onClick={() => {
								if (rndProgress === 0 || rndProgress === rndProgressMax)
									setTrackListSample([]);
						            openPopupRandomPlst(false);
					        }}>
						Cancel
					</button>
				</div>

				<div>{rndProgress >= rndProgressMax ? "DONE" : rndProgress > 0 && <progress max={rndProgressMax} value={rndProgress}/>}</div>
			</Popup>

			<div className="playlists">
				{playlists.length === 0 && "Loading ... or you don't have any playlists"}
				{playlists.map((x) => (
					<div onDragStart={entryDragStartHandler}
					     onTouchStart={entryTouchStartHandler}
					     onTouchMove={entryTouchMoveHandler}
					     onTouchEnd={entryTouchEndHandler}
					     onTouchCancel={entryTouchCancelHandler}
					     draggable="true"
					     data-playlist={x.id}
					     key={x.id} className="entry">
						<a href={x.uri} style={{fontSize: "75%", textDecoration: "none"}}>PLAY ON SPOTIFY</a>
						<div onClick={() => selectPlaylistHelper(x.id)}>
							<img src={x.images.first()?.url} data-playlist={x.id} alt={""}/>
							{x.name}
						</div>
					</div>
				))}
			</div>

			{!!dedupMax && (<progress max={dedupMax} value={dedupProgress}/>)}
			<div className="playlistsDedup"
			     onDragOver={(e) => e.preventDefault()}
			     onDragEnter={dragEnterHandler}
			     onDragLeave={dragLeaveHandler}
			     onDrop={dropHandler}>
				{dedupPlaylists.map((x) => (
					<div onClick={() => selectPlaylistHelper(x.id)}
					     onDragStart={entryDragStartHandler}
					     onDragEnter={() => dragEntry(x.id)}
					     draggable="true"
					     data-playlist={x.id}
					     key={x.id} className="entryDedup">
						<img src={x.images.first()?.url} data-playlist={x.id} alt={""}/>
						{x.name}
					</div>
				))}
				<h2 className="dedupText">
					{dedupPlaylists.length < 10 &&
						<div>Click on playlist or Drag&Drop HERE</div>}
					{dedupPlaylists.length < 5 && <div>(tracks remain in the playlist earlier in the list)</div>}
				</h2>
			</div>

			<div className="actions" style={dedupPlaylists.length ? {} : {display: "none"}}>
				<button onClick={() => removeTracks(ERemovalMode.Dedup)} className="button light save">
					Remove duplicates
				</button>
				<button onClick={() => removeTracks(ERemovalMode.Unavailable)} className="button light save">
					Remove unplayable
				</button>
				<button onClick={() => {setTrackListSample([]); setRndProgress(0); openPopupRandomPlst(true)}} className="button light save">
					Create RND plst
				</button>
				<button onClick={() => removeTracks(ERemovalMode.Search)} className="button light save">
					Track search
				</button>
				<button onClick={() => setDedup(playlists)} className="button light save">
					Add all
				</button>
				<button onClick={() => cleanDedupList()} className="button light save">
					Clean list
				</button>
			</div>

			<br/>
			{selectedPlaylist && <Playlist id={selectedPlaylist} idRef={playlistRef} playlists={playlists}/>}
		</div>
	);
}
