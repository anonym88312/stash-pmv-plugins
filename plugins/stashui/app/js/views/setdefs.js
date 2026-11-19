// The catalog of the Settings page: groups → sections → settings. Pure data (no imports), so the page,
// the search and the translation tools all read the same list.
//
// A setting is one of:
//   { k: "switch" | "select" | "range" | "number" | "text" | "chips", id, title, hint, src, … }   (instant, saved when changed)
//   "area.field"  or  { f: "area.field", title?, hint? }                                           (a field Stash itself stores – read live from its schema, saved with the Save bar)
//   { k: "block", id, block, title, hint, terms? }                                                 (a hand-made control, see setblocks.js)
//   { k: "heading", title, hint? } · { k: "info", … } · { k: "link", … }
// "classic" lists the options that only change classic Stash (the original interface) – folded at the end of a section.
//
// Sources (`src`): where the value lives
//   local  = this browser (store)            ui = Stash's own "ui" map (shared with classic Stash)
//   plugin = this plugin's config in Stash   obj = one key inside a store object      fn = a named getter/setter (settings.js)
// Titles and hints are the English texts (translated when shown); where an option exists in classic Stash the wording is Stash's own.

export const L = (key, def) => ({ t: "local", key, def });
export const U = (key, def) => ({ t: "ui", key, def });
export const P = (key, def, inv) => ({ t: "plugin", key, def, inv });
export const O = (key, path, def) => ({ t: "obj", key, path, def });
export const F = (id) => ({ t: "fn", id });

export const GROUPS = [
  { id: "look", title: "Look and feel", intro: "Colors, language, the menu." },
  { id: "browse", title: "Browsing", intro: "Lists, cards, detail pages, privacy." },
  { id: "watch", title: "Watching", intro: "The video player, pictures, interactive devices." },
  { id: "library", title: "Library", intro: "Folders, generated files, transcoding, scrapers." },
  { id: "server", title: "Server", intro: "Security, paths, services, log, database." },
  { id: "more", title: "More", intro: "Plugins, custom code, backup, about." },
];

const RATING = [["auto", "Automatic"], ["off", "Hidden"]];
const CORNERS = [["tl", "Top left"], ["tr", "Top right"], ["bl", "Bottom left"], ["br", "Bottom right"]];

export const SECTIONS = [
  // ───────────────────────── Look and feel
  { id: "look", group: "look", title: "Appearance", intro: "Colors, liquid glass, animations, the name and icon in the browser tab.", items: [
    { k: "block", id: "theme", block: "theme", title: "Colors", terms: ["Liquid glass", "Background picture", "Colors"] },
    { k: "switch", id: "fx", title: "Effects and animations", hint: "Button shine and ripples, tilting cards with a moving light, a wipe on page changes and a glow behind the mouse. Off by itself when your system asks for less motion.", src: L("fx", true) },
    { k: "switch", id: "tileWall", title: "Tight, square thumbnails", hint: "Removes the gaps between the thumbnails and the rounded corners, so everything sits tight and square-edged. Not used in the card view.", later: true, src: L("tileWall", false) },
    { k: "text", id: "pageTitle", title: "Page title", hint: "The name in the browser tab. Empty = “Stash UI”.", src: L("pageTitle", ""), placeholder: "Stash UI", max: 60 },
    { k: "block", id: "favicon", block: "favicon", title: "Tab icon", hint: "A small picture for the browser tab (any image – it is cut square and made small). Kept in this browser." },
  ], classic: [
    { k: "text", id: "uiTitle", title: "Custom title", hint: "Custom text to append to the page title. If empty, defaults to 'Stash'.", src: U("title", ""), placeholder: "Stash" },
  ] },
  { id: "language", group: "look", title: "Language and ratings", intro: "The language of this interface and how ratings are shown.", items: [
    { k: "select", id: "lang", title: "Language", hint: "“Automatic” follows the language set in Stash (classic Stash → Settings → Interface).", src: F("lang"), options: "langs" },
    { k: "select", id: "ratesys", title: "Rating system", hint: "How ratings are shown and set. Saved in Stash – classic Stash uses the same setting.", src: F("ratesys"), options: [["stars:full", "Stars (whole)"], ["stars:half", "Stars (half)"], ["stars:quarter", "Stars (quarter)"], ["stars:tenth", "Stars (tenth)"], ["decimal:", "Decimal (0.0–10.0)"]] },
  ], classic: ["interface.language"] },
  { id: "navigation", group: "look", title: "Menu and start page", intro: "The menu on the left, what opens first, installing as an app.", items: [
    { k: "select", id: "railMode", title: "Menu on the left", hint: "Full, icons only, or hidden until you press the menu button in the top left corner. The button at the top of the menu switches between them too.", src: L("railMode", "full"), options: [["full", "Full"], ["mini", "Icons only"], ["hidden", "Hidden"]] },
    { k: "range", id: "railWidth", title: "Menu width", hint: "How wide the menu on the left is (on a computer).", src: L("railWidth", 236), min: 180, max: 360, step: 4 },
    { k: "block", id: "extmenu", block: "extmenu", title: "Other plugins in the menu", hint: "Plugins with their own page get an entry under “Extensions” on the left. Fold the group with a click on its heading, or hide it here – all of it or single plugins." },
    { k: "switch", id: "home", title: "This interface as home page", hint: "Opening Stash goes straight to this interface. Off = classic Stash stays the home page.", src: P("keepClassicHome", false, true), mirror: "keepClassicHome" },
    { k: "block", id: "install", block: "install", title: "Install as app" },
    { k: "info", id: "customize", title: "Home page and sidebar", hint: "What the start page shows and which menu entries there are: Home → Customize." },
  ], classic: [{ k: "block", id: "menuitems", block: "menuitems", title: "Menu items", hint: "Show or hide different types of content on the navigation bar." }] },

  // ───────────────────────── Browsing
  { id: "lists", alias: "wall grid thumbnail size hover preview", group: "browse", title: "Lists and thumbnails", intro: "How the lists of scenes, images, performers … look and what the thumbnails do.", items: [
    { k: "range", id: "rowHeight", title: "Thumbnail size", hint: "How tall a row in the lists is.", src: L("rowHeight", 250), min: 130, max: 480, step: 10 },
    { k: "select", id: "cardFormat", title: "Thumbnail shape", hint: "Each as its picture is – or all as posters (portrait) or all as scenes (landscape).", src: L("cardFormat", "auto"), options: [["auto", "As the picture is"], ["poster", "Posters (portrait)"], ["scene", "Scenes (landscape)"]] },
    { k: "select", id: "previewMode", title: "Hover previews", hint: "Whether a thumbnail plays a short clip when you point at it.", src: L("previewMode", "on"), options: [["on", "Always"], ["auto", "Always, and all in view play by themselves"], ["off", "Never"], ["poster", "Not with posters"]] },
    { k: "switch", id: "previewSound", title: "Sound in previews", hint: "Hover previews play with sound (at the player's volume). Stash only puts sound into previews when “Preview audio” is on under Previews – regenerate them after switching it on.", src: L("previewSound", true) },
    { k: "switch", id: "zipperOn", title: "Zipper for fast scrolling", hint: "A handle at the edge of the lists: pull it to scroll fast – the further you pull, the faster. Let go and it springs back.", src: L("zipperOn", true) },
    { k: "select", id: "zipperFx", title: "Zipper: animation", hint: "How the thumbnails move while you scroll fast. Off when your system asks for less motion.", src: L("zipperFx", "hourglass"), options: [["hourglass", "Hourglass"], ["zoom", "Zoom out"], ["drum", "Drum"], ["blur", "Blur"], ["none", "Off"]] },
    { k: "select", id: "zipperSpeed", title: "Zipper: top speed", hint: "How fast it scrolls when the handle is pulled all the way.", src: L("zipperSpeed", "normal"), options: [["slow", "Slow"], ["normal", "Normal"], ["fast", "Fast"], ["turbo", "Very fast"]] },
    { k: "select", id: "zipperSide", title: "Zipper: side", hint: "Which edge of the screen the handle sits on.", src: L("zipperSide", "right"), options: [["right", "Right"], ["left", "Left"]] },
  ], classic: [
    "interface.soundOnPreview",
    { k: "number", id: "previewVolume", title: "Preview volume", hint: "Volume of the preview when hovering over a scene. Set to 0 to mute.", src: U("previewVolume", 0), min: 0, max: 100, unit: "%" },
    "interface.wallShowTitle",
    "interface.wallPlayback",
    { k: "number", id: "imageWallMargin", title: "Margin (pixels)", hint: "Number of margin pixels around each entire image.", src: U("imageWallOptions.margin", 3), min: 0, max: 100 },
    { k: "select", id: "imageWallDirection", title: "Direction", hint: "Column or row based layout.", src: U("imageWallOptions.direction", "row"), options: [["row", "Row"], ["column", "Column"]] },
  ] },
  { id: "cards", group: "browse", title: "Cards and badges", intro: "What a thumbnail or card shows: badges, studio logo, extra lines.", items: [
    { k: "heading", title: "Scenes" },
    { k: "switch", id: "studioLogos", title: "Studio on scenes", hint: "Shows the studio's logo (or its name) in the corner of scene thumbnails.", src: L("studioLogos", false) },
    { k: "select", id: "studioPos", title: "Studio logo: corner", hint: "Where the logo sits on a thumbnail.", src: L("studioPos", "bl"), options: [["bl", "Bottom left"], ["br", "Bottom right"], ["tl", "Top left"], ["tr", "Top right"]] },
    { k: "select", id: "studioSize", title: "Studio logo: size", hint: "How big the logo is.", src: L("studioSize", "m"), options: [["s", "Small"], ["m", "Medium"], ["l", "Large"], ["xl", "Extra large"]] },
    { k: "select", id: "badgeRating", title: "Rating badge", hint: "Where the rating sits on a thumbnail. Automatic: only on the card view (bottom left).", later: true, src: L("badgeRating", "auto"), options: [...RATING, ...CORNERS] },
    { k: "select", id: "ratingStyle", title: "Rating badge: colour", hint: "The colour can follow the rating – from red (low) to green (high).", src: L("ratingStyle", "plain"), options: [["plain", "Dark"], ["tint", "Coloured text"], ["fill", "Filled with the colour"]] },
    { k: "select", id: "badgeTier", title: "Tier badge", hint: "Where the tier (S–F) sits on a thumbnail. Automatic: top left.", later: true, src: L("badgeTier", "auto"), options: [...RATING, ...CORNERS] },
    { k: "select", id: "badgeStamp", title: "Length badge", hint: "Where the length (and resolution) sits on a thumbnail. Automatic: top right.", later: true, src: L("badgeStamp", "auto"), options: [...RATING, ...CORNERS] },
    { k: "switch", id: "cardRes", title: "Resolution on scene cards", hint: "Shows 1080p, 720p … next to the length in the corner of scene thumbnails (after the next page load).", src: L("cardRes", false) },
    { k: "chips", id: "cardInfo", title: "Info on scene cards", hint: "Extra lines under the date when scenes are shown as cards. Click to switch each one on or off.", src: { t: "flags", key: "cardInfo", base: "cardInfo" }, options: [["watched", "Last watched"], ["added", "Added"], ["time", "Watch time"], ["size", "File size"]] },
    { k: "select", id: "cistyle", title: "Dates on scene cards", hint: "Last watched and Added: the exact date, or how many days ago.", src: O("cardInfo", "style", "date"), base: "cardInfo", options: [["date", "Exact date"], ["days", "Days ago"]] },
    { k: "switch", id: "cihour", title: "With the time", hint: "Adds the hour and minute to those dates.", src: O("cardInfo", "hour", false), base: "cardInfo" },
    { k: "select", id: "ciclock", title: "Time format", hint: "How the time of day is written when “With the time” is on.", src: O("cardInfo", "clock", "auto"), base: "cardInfo", options: [["auto", "Automatic"], ["24", "24-hour (14:25)"], ["12", "12-hour (2:25 PM)"]] },
    { k: "heading", title: "Performers" },
    { k: "chips", id: "perfInfo", title: "Info on performer cards", hint: "What the cards of the Performers page say under the name. Click to switch each one on or off (after the next page load).", src: { t: "flags", key: "perfInfo", base: "perfInfo" }, options: [["scenes", "Scenes"], ["images", "Images"], ["age", "Age"], ["rating", "Rating"], ["country", "Country"], ["ethnicity", "Ethnicity"], ["hair", "Hair color"], ["eye", "Eye color"], ["height", "Height"], ["tags", "Tags"]] },
    { k: "switch", id: "perfHover", title: "Other pictures on performer cards", hint: "While the mouse rests on a performer card, it shows other pictures of that performer from your library, one after the other. Not on touch screens.", src: L("perfHover", true) },
  ], classic: [
    "interface.showStudioAsText",
    { k: "switch", id: "showLinksOnPerformerCard", title: "Display links on performer grid cards", src: U("showLinksOnPerformerCard", false) },
    { k: "switch", id: "abbreviateCounters", title: "Abbreviate counters", hint: "Abbreviate counters in cards and details view pages, for example \"1831\" will get formated to \"1.8K\".", src: U("abbreviateCounters", false) },
    { k: "switch", id: "showTagCardOnHover", title: "Tag card tooltips", hint: "Show tag card when hovering tag badges.", src: U("showTagCardOnHover", true) },
  ] },
  { id: "details", group: "browse", title: "Detail pages and editing", intro: "Descriptions, editing, what is saved where and what is the default when deleting.", items: [
    { k: "switch", id: "markdown", title: "Markdown in descriptions", hint: "Details and descriptions of scenes, images, galleries, groups, performers, studios and tags can have **bold**, *italic*, lists, headings, links and tables. Links open in a new tab; pictures and raw HTML are never shown.", src: L("markdown", true) },
    { k: "block", id: "clipsdir", block: "clipsdir", title: "Folder for new clips and GIFs", hint: "Every clip, GIF and edit you make is saved here, all together – not next to each original. Needs a full path (e.g. E:\\Stash\\Clips) and should lie inside a library folder, so Stash finds the files. Empty = next to each original." },
    { k: "info", id: "favorites", title: "Favorites", hint: "The heart is the Stash tag “Favorite”. You'll find it in classic Stash too." },
    { k: "heading", title: "Delete options", hint: "Default settings when deleting images, galleries, and scenes." },
    { k: "switch", id: "deleteFile", title: "Delete file by default", src: { t: "defaults", key: "deleteFile", def: false } },
    { k: "switch", id: "deleteGenerated", title: "Delete generated supporting files by default", src: { t: "defaults", key: "deleteGenerated", def: true } },
  ], classic: [
    { k: "switch", id: "showAllDetails", title: "Show all details", hint: "When enabled, all content details will be shown by default and each detail item will fit under a single column.", src: U("showAllDetails", true) },
    { k: "switch", id: "compactExpandedDetails", title: "Compact expanded details", hint: "When enabled, this option will present expanded details while maintaining a compact presentation.", src: U("compactExpandedDetails", false) },
    { k: "switch", id: "showStudioText", title: "Show studio as text", hint: "Always display studio name as text on details views instead of an icon.", src: U("showStudioText", false) },
    { k: "uigroup", id: "bgimage", title: "Enable background image", hint: "Display background image on detail page.", items: [["enableMovieBackgroundImage", "Groups"], ["enablePerformerBackgroundImage", "Performers"], ["enableStudioBackgroundImage", "Studios"], ["enableTagBackgroundImage", "Tags"]] },
    { k: "switch", id: "showChildTagContent", title: "Display sub-tag content", hint: "In the tag view, display content from the sub-tags as well.", src: U("showChildTagContent", false) },
    { k: "switch", id: "showChildStudioContent", title: "Display sub-studios content", hint: "In the studio view, display content from the sub-studios as well.", src: U("showChildStudioContent", false) },
    { k: "tgroup", id: "dropdownCreate", title: "Disable dropdown create", hint: "Remove the ability to create new objects from the dropdown selectors.", f: [["interface.disableDropdownCreate.performer", "Performers"], ["interface.disableDropdownCreate.studio", "Studios"], ["interface.disableDropdownCreate.tag", "Tags"], ["interface.disableDropdownCreate.movie", "Groups"], ["interface.disableDropdownCreate.gallery", "Galleries"]] },
    { k: "number", id: "maxOptionsShown", title: "Maximum number of items to show in select dropdowns", src: U("maxOptionsShown", 200), min: 1, max: 5000 },
  ] },
  { id: "privacy", alias: "nsfw sfw blur hide hidden", group: "browse", title: "Privacy and hiding", intro: "Blur pictures, hide folders from every page.", items: [
    { k: "switch", id: "nsfw", title: "NSFW mode", hint: "Blurs all pictures and hover previews – also with the eye button at the top of the menu on the left.", src: L("nsfw", false) },
    { k: "select", id: "nsfwScope", title: "NSFW mode: what is blurred", hint: "Thumbnails and previews – or also the player and the image viewer.", src: L("nsfwScope", "cards"), options: [["cards", "Thumbnails and previews"], ["all", "Everything, also player and viewer"]] },
    { k: "range", id: "nsfwBlur", title: "NSFW mode: blur strength", src: L("nsfwBlur", 18), min: 6, max: 40, step: 2 },
    { k: "switch", id: "nsfwHover", title: "NSFW mode: clear while the mouse is on it", hint: "A thumbnail shows sharp as long as you point at it.", src: L("nsfwHover", false) },
    { k: "block", id: "nsfwtags", block: "nsfwtags", title: "NSFW mode: never blur these tags", hint: "Scenes, images and galleries with one of these tags stay sharp (thumbnails and, with “Everything”, the player and viewer). Applies to lists the next time they load." },
    { k: "heading", title: "Hidden folders" },
    { k: "block", id: "hidden", block: "hidden", title: "Hidden folders", hint: "What lies in a hidden folder shows up on no page – only when you open the folder itself. Hide a folder on its page (Folders → open it → “Hide this folder”). Numbers such as the scene count of a performer or tag may still include it." },
    { k: "block", id: "hidenames", block: "hidenames", title: "Show hidden folders on the Folders page", hint: "Off: the hidden folders aren't listed anywhere – open one from the list above." },
  ], classic: ["interface.sfwContentMode"] },
  { id: "large", group: "browse", title: "Large libraries", intro: "Keeps Stash UI fast when the library has tens of thousands of files.", items: [
    { k: "select", id: "folderMode", title: "Folder loading", hint: "Counting the folders reads the whole library once (then it's remembered) – on very big libraries that can take very long. “Off” loads no folders at all.", src: F("foldermode"), options: [["all", "Everywhere"], ["page", "Only on the Folders page"], ["off", "Off"]] },
    { k: "select", id: "largeMode", title: "Large library mode", hint: "For libraries with very many files (from 20 000 scenes or 100 000 images): folders aren't counted on their own, the home page loads what you scroll to, Versus plays preview clips, scans of all funscripts wait for a click. Takes effect after reloading the page.", src: L("largeMode", "auto"), options: [["auto", "Automatic"], ["on", "On"], ["off", "Off"]], after: "large" },
    { k: "select", id: "vsMedia", title: "Versus: scenes", hint: "What a scene shows in Versus: the whole video (jumping through it) or only the preview clip – lighter on slow disks. Automatic follows the large library mode.", src: L("vsMedia", "auto"), options: [["auto", "Automatic"], ["preview", "Preview clips"], ["full", "Whole video"]] },
  ] },

  // ───────────────────────── Watching
  { id: "player-ui", group: "watch", title: "Video player", intro: "How videos start, end and react to the mouse.", items: [
    { k: "select", id: "pmode", title: "At the end of a video", hint: "The same as the button in the player bar – a click there cycles through these.", src: F("pmode"), options: [["order", "In order"], ["shuffle", "Random order"], ["one", "Repeat this video"], ["all", "Repeat all"], ["stop", "Stop at the end"]] },
    { k: "switch", id: "autoplay", title: "Start playing when a scene opens", hint: "Off: opening a scene shows the first picture and waits for the play button. Going on to the next video from the player always plays.", src: O("player", "autoplay", true) },
    { k: "switch", id: "fromStart", title: "Always start from the beginning", hint: "Scenes you stopped halfway begin at 0:00 instead of where you left off. The saved point stays in Stash; the hint offers it as a button.", src: O("player", "fromStart", false) },
    { k: "switch", id: "randomStart", title: "Start at a random spot", hint: "Every scene starts somewhere in the middle – for browsing around. Your resume points in Stash stay as they are.", src: O("player", "randomStart", false) },
    { k: "select", id: "wheel", title: "Mouse wheel on the video", hint: "Turn the wheel over the picture to change the volume or to jump (5 s per notch); hold Shift for the other one.", src: O("player", "wheel", "volume"), options: [["volume", "Volume"], ["seek", "Jump forward / back"], ["off", "Off"]] },
    { k: "switch", id: "keySeek", title: "Jump to keyframes", hint: "The mouse wheel, the arrow keys and the ±10 buttons jump to the nearest keyframe, like KMP or VLC: much faster with big 4K files, but the steps get a little uneven (+3…+7 s instead of +5). Only for MP4 / MOV played directly; clicks on the timeline stay exact.", src: O("player", "keySeek", true) },
    { k: "switch", id: "wheelRev", title: "Reverse the wheel", hint: "Normally turning the wheel up makes it louder or jumps forward. Switch this on and up goes quieter / back, down louder / forward.", src: O("player", "wheelRev", false) },
    { k: "switch", id: "scrubPeek", title: "Picture when hovering the timeline", hint: "Hover the timeline in the player to see a small picture of that moment above the pointer (needs Stash's timeline images – Tasks → Generate → Timeline images). Not shown on touch screens.", src: O("player", "scrubPeek", true) },
    { k: "switch", id: "fsPanel", title: "Info panel in fullscreen", hint: "Move the mouse to the right edge in fullscreen to slide in the info panel.", src: O("player", "fsPanel", true) },
    { k: "switch", id: "omark", title: "O marks the moment", hint: "Pressing O (key or button) in the player also remembers the spot in the video. Shift+O marks it without counting an O.", src: F("omark") },
    { k: "switch", id: "oshow", title: "Show the O clip at the O moments", hint: "From a marked O moment on, the O clip you chose plays in a small window next to the video (info bar → O moments).", src: F("oshow") },
    { k: "block", id: "extplayers", block: "extplayers", title: "External players", hint: "The “External player” button in a scene's info panel hands the video to a player on this device – for formats the browser can't play. Choose the ones to offer; some need a small helper installed (see below each)." },
  ], classic: [
    "interface.autostartVideo",
    "interface.autostartVideoOnPlaySelected",
    "interface.continuePlaylistDefault",
    "interface.showScrubber",
    "interface.maximumLoopDuration",
    { k: "switch", id: "showAbLoopControls", title: "Show AB loop controls", src: U("showAbLoopControls", false) },
    { k: "switch", id: "showRangeMarkers", title: "Show range markers", src: U("showRangeMarkers", false) },
    { k: "switch", id: "alwaysStartFromBeginning", title: "Always start video from beginning", src: U("alwaysStartFromBeginning", false) },
    { k: "switch", id: "trackActivity", title: "Enable scene play history", src: U("trackActivity", true) },
    { k: "number", id: "minimumPlayPercent", title: "Minimum play percent", hint: "The percentage of time in which a scene must be played before its play count is incremented.", src: U("minimumPlayPercent", 0), min: 0, max: 100, unit: "%" },
    { k: "text", id: "vrTag", title: "VR tag", hint: "The VR button will only be displayed for scenes with this tag.", src: U("vrTag", "") },
    { k: "switch", id: "enableChromecast", title: "Enable Chromecast", src: U("enableChromecast", false) },
    { k: "switch", id: "disableMobileAutoRotate", title: "Disable auto-rotate of fullscreen media on mobile", src: U("disableMobileMediaAutoRotateEnabled", false) },
  ] },
  { id: "images", group: "watch", title: "Images and galleries", intro: "The image viewer and the slideshow.", items: [
    { k: "select", id: "vanim", title: "Image viewer: turning the page", hint: "How the next picture comes in. Arrow keys, a swipe (finger or dragging with the mouse) and the arrows on the sides all turn the page.", src: F("vanim"), options: [["fade", "Fade"], ["slide", "Slide in"], ["zoom", "Zoom in"], ["none", "None"]] },
  ], classic: [
    "interface.imageLightbox.slideshowDelay",
    "interface.imageLightbox.displayMode",
    "interface.imageLightbox.scaleUp",
    "interface.imageLightbox.resetZoomOnNav",
    "interface.imageLightbox.scrollMode",
    "interface.imageLightbox.scrollAttemptsBeforeChange",
    "interface.imageLightbox.disableAnimation",
  ] },
  { id: "interactive", group: "watch", title: "Handy and funscripts", intro: "Connect The Handy and set how funscripts play.", items: [
    { k: "block", id: "handy", block: "handy", title: "The Handy", terms: ["Connection key", "Script offset", "The Handy fetches the script from Stash", "Test the connection"] },
    { k: "link", id: "interactivepage", title: "Interactive scenes", hint: "All scenes with a funscript, funscript tools and the Handy test.", href: "#/interactive", btn: "Open" },
  ] },

  // ───────────────────────── Library
  { id: "library", alias: "scan stash folders extensions exclude hash md5 gallery", group: "library", title: "Folders and files", intro: "Which folders Stash scans and which files belong to the library.", items: [
    "general.stashes",
    { k: "heading", title: "Media content extensions" },
    "general.videoExtensions", "general.imageExtensions", "general.galleryExtensions",
    { k: "heading", title: "Exclusions" },
    "general.excludes", "general.imageExcludes",
    { k: "heading", title: "Galleries and images" },
    "general.createGalleriesFromFolders", "general.galleryCoverRegex", "general.writeImageThumbnails", "general.createImageClipsFromVideos",
    { k: "heading", title: "Hashing" },
    "general.calculateMD5", "general.videoFileNamingAlgorithm",
  ] },
  { id: "previews", alias: "sprites thumbnails generate preview heatmap", group: "library", title: "Previews and generated files", intro: "How hover previews and timeline images are generated.", items: [
    "general.parallelTasks",
    { k: "heading", title: "Preview generation" },
    "general.previewSegments", "general.previewSegmentDuration", "general.previewExcludeStart", "general.previewExcludeEnd", "general.previewPreset", "general.previewAudio",
    { k: "heading", title: "Timeline images (sprites)" },
    "general.useCustomSpriteInterval", "general.spriteInterval", "general.minimumSprites", "general.maximumSprites", "general.spriteScreenshotSize",
    { k: "heading", title: "Funscript heatmaps" },
    "general.drawFunscriptHeatmapRange",
  ] },
  { id: "playback", alias: "transcode transcoding hardware acceleration gpu ffprobe", group: "library", title: "Transcoding and FFmpeg", intro: "Playing videos the browser can't play directly, and the FFmpeg programs Stash uses.", items: [
    "general.maxStreamingTranscodeSize", "general.maxTranscodeSize", "general.transcodeHardwareAcceleration",
    { k: "heading", title: "FFmpeg" },
    "general.ffmpegPath", "general.ffprobePath",
    { k: "block", id: "dlffmpeg", block: "dlffmpeg", title: "Download FFmpeg", hint: "Downloads FFmpeg into the configuration directory and clears the ffmpeg and ffprobe paths to resolve from the configuration directory." },
    { k: "heading", title: "Advanced: FFmpeg arguments" },
    "general.transcodeInputArgs", "general.transcodeOutputArgs", "general.liveTranscodeInputArgs", "general.liveTranscodeOutputArgs",
  ] },
  { id: "scraping", alias: "scraper stashbox stash-box api key endpoint user agent", group: "library", title: "Scrapers and stash-boxes", intro: "Where metadata comes from: stash-box accounts, scraper connection settings, package sources.", items: [
    { k: "heading", title: "Stash-box endpoints", hint: "Stash-box facilitates automated tagging of scenes and performers based on fingerprints and filenames. Endpoint and API key can be found on your account page on the stash-box instance. Names are required when more than one instance is added." },
    "general.stashBoxes",
    { k: "heading", title: "Scraping" },
    "scraping.scraperUserAgent", "scraping.scraperCDPPath", "scraping.scraperCertCheck", "scraping.excludeTagPatterns",
    { k: "heading", title: "Scraper package sources" },
    "general.scraperPackageSources",
    { k: "link", id: "scrapers", title: "Installed scrapers", hint: "Install, update and remove scrapers in classic Stash.", href: "#/extern/classic-settings?path=%2Fsettings%3Ftab%3Dmetadata-providers", btn: "Open in classic Stash" },
  ] },

  // ───────────────────────── Server
  { id: "login", alias: "authentication password credentials session username", group: "server", title: "Security and login", intro: "With a username and password, Stash asks for a login when opened.", items: [
    "general.username", "general.password", "general.maxSessionAge",
    { k: "block", id: "apikey", block: "apikey", title: "API key", hint: "For external programs. Generating a new one invalidates the old one." },
  ] },
  { id: "paths", group: "server", title: "Paths and storage", intro: "Where Stash keeps its database, backups and generated files. Changes here usually take effect after restarting Stash.", items: [
    "general.databasePath", "general.backupDirectoryPath", "general.deleteTrashPath", "general.generatedPath", "general.metadataPath", "general.cachePath",
    "general.blobsStorage", "general.blobsPath", "general.scrapersPath", "general.pluginsPath", "general.customPerformerImageLocation", "general.pythonPath",
    { k: "block", id: "configfile", block: "configfile", title: "Configuration file" },
  ] },
  { id: "services", alias: "dlna upnp tv browser notifications", group: "server", title: "DLNA and startup", intro: "Show the library to TVs on your network; what Stash does when it starts.", items: [
    { k: "heading", title: "DLNA", hint: "Makes the library visible to TVs and other devices on your home network." },
    { k: "block", id: "dlnastatus", block: "dlnastatus", title: "DLNA status", hint: "Is the server running right now?" },
    "dlna.enabled", "dlna.serverName", "dlna.port", "dlna.whitelistedIPs", "dlna.interfaces", "dlna.videoSortOrder",
    { k: "heading", title: "Desktop integration" },
    "interface.noBrowser", "interface.notificationsEnabled",
  ] },
  { id: "log", alias: "logging debug trace logfile", group: "server", title: "Log", intro: "What Stash logs – and the latest entries.", items: [
    "general.logLevel", "general.logFile", "general.logOut", "general.logAccess", "general.logFileMaxSize",
    { k: "block", id: "logs", block: "logs", title: "Latest entries" },
  ] },
  { id: "database", alias: "backup optimise optimize vacuum sqlite clean", group: "server", title: "Database", intro: "Back up, optimize, clean up.", items: [
    { k: "block", id: "system", block: "system", title: "Back up database", terms: ["Back up database", "Optimize database", "Clean up generated files"] },
  ] },

  // ───────────────────────── More
  { id: "plugins", alias: "package source", group: "more", title: "Plugins and extensions", intro: "Where plugins come from, and the settings of extension plugins.", items: [
    { k: "link", id: "pluginpage", title: "Installed plugins", hint: "Install, update, switch on and off, and the settings of each plugin.", href: "#/plugins", btn: "Open" },
    { k: "heading", title: "Plugin package sources" },
    "general.pluginPackageSources",
  ] },
  { id: "custom", group: "more", title: "Custom code and classic Stash", intro: "Custom CSS and JavaScript, troubleshooting, and how classic Stash looks. These change classic Stash, not this interface.", items: [
    { k: "switch", id: "plainClassic", title: "Style classic Stash like this interface", hint: "Off: classic Stash keeps its own look (reload its page after changing this); only this interface is styled.", src: P("plainClassic", false, true), mirror: "plainClassic" },
    { k: "link", id: "classic", title: "Classic Stash", hint: "The original interface of Stash.", href: "#/extern/classic", btn: "Open in classic Stash" },
    { k: "heading", title: "Custom CSS" },
    "interface.cssEnabled", "interface.css",
    { k: "heading", title: "Custom JavaScript" },
    "interface.javascriptEnabled", "interface.javascript",
    { k: "heading", title: "Custom localisation" },
    "interface.customLocalesEnabled", "interface.customLocales",
    { k: "heading", title: "Troubleshooting" },
    { k: "block", id: "trouble", block: "trouble", title: "Troubleshooting mode", hint: "Switches off all plugins, custom CSS, JavaScript and localisation of classic Stash for a while, to find out what causes a problem." },
  ] },
  { id: "backup-ui", group: "more", title: "Backup and reset", intro: "Save and restore everything this interface remembers.", items: [
    { k: "switch", id: "autobk", title: "Automatic backup in Stash", hint: "Copies the settings of this browser to Stash a little after they change. A browser that forgot them (site data cleared, another address, a new device) gets them back by itself.", src: L("autoBackup", true) },
    { k: "block", id: "backup", block: "backup", title: "Backup and restore", hint: "Saves everything this interface remembers – settings of this browser, home page and menu, ratings, playlists, Versus, funscript variants – in one file, and puts it back (also in another browser). It may contain your Handy connection key, so keep the file private." },
    { k: "block", id: "reset", block: "reset", title: "Reset interface settings", hint: "Everything this interface remembers in this browser – player and viewer settings, thumbnail size, expanded folders, the home page and more. Not the queue, the colors or the glass look." },
  ] },
  { id: "about", alias: "version update release changelog tools", group: "more", title: "About and tools", intro: "Versions, links, and where the tools of Stash went.", items: [
    { k: "block", id: "about", block: "about", title: "Version", terms: ["Version", "Check for new version", "Build hash", "Build time"] },
    { k: "heading", title: "Where is …?" },
    { k: "link", id: "gotasks", title: "Tasks", hint: "Scan, generate, clean, identify and the other jobs.", href: "#/tasks", btn: "Open" },
    { k: "link", id: "gotools", title: "Scene duplicate checker", hint: "Finds videos that exist twice.", href: "#/duplicates", btn: "Open" },
    { k: "link", id: "gotagger", title: "Scene filename parser", hint: "Turns file names into titles, dates, studios and tags – in classic Stash.", href: "#/extern/classic-settings?path=%2Fsettings%3Ftab%3Dtools", btn: "Open in classic Stash" },
    { k: "link", id: "gogql", title: "GraphQL playground", hint: "Try Stash's API.", href: "#/extern/classic-settings?path=%2Fplayground", btn: "Open in classic Stash" },
    { k: "link", id: "gonews", title: "Changelog", hint: "What changed in Stash UI.", href: "#/whatsnew", btn: "Open" },
  ] },
];

// Everything Stash stores that no section above lists ends up here (new options after a Stash update)
export const OTHER = { id: "other", group: "more", title: "Other Stash options", intro: "Everything that isn't sorted in anywhere else.", items: [] };

// Settings that used to be elsewhere keep working (links, What's new)
export const ALIASES = { "this-ui": "navigation", "classic-ui": "custom", scraper: "scraping", dlna: "services", more: "other", "player": "player-ui" };

// the places of Stash that are not in the Settings page – for the overview
export const ELSEWHERE = [
  { title: "Tasks", hint: "Scan, generate, clean, identify and the other jobs.", href: "#/tasks" },
  { title: "Plugins", hint: "Install, update and set up plugins.", href: "#/plugins" },
  { title: "Statistics", hint: "How much there is and what you watch.", href: "#/stats" },
  { title: "What's new", hint: "What changed in Stash UI.", href: "#/whatsnew" },
];
