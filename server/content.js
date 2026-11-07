// Authored text. Cheryl's four intervention points are §12.13–12.17 of the Design Bible, verbatim.
const CHERYL = {
  opening: (name) =>
    `Alright people, welcome to The Cup. I'm Cheryl, and I keep an eye on things around here. Drinks at the bar when you need them, sneaky side bets when you don't. Keep the banter channel clean, or as clean as you can (${name}, I'm looking at you). Happy punting, team. I'll spin up your first group bettor in a moment.`,
  sneaky: (tableNo, tables) => (tables > 1 ? `Sneaky on Table ${tableNo}.` : `Someone's placed a sneaky.`),
  silence: [
    'Geeze Team, this is a pub not a library.',
    "Y'all are acting like a bunch of strangers on a prison bus over there.",
    'Did anybody hear that? I think it was a pin dropping.',
    'Did you hear the one about the Jockey and the Milkmaid? …Nah, me either.',
    "You're all sitting on your hands like the stewards are watching.",
    'You lot are about as lively as week-old chips.',
    "I'd ask if you're all still there, but I can literally see you.",
    'So… seen any good movies lately?',
    "Righto you lot, I've seen livelier crowds at a funeral.",
    "What's the easiest way to make a small fortune on the punt? Start with a large one.",
  ],
  close: "Good session people. Bar's still open.",
};

// Regulars' banter, keyed by table moment. Tokens: {bettor} {runner} {odds} {type} {meeting} {name} {arrival} {leaver} {count} {no}
const BANTER = {
  arrival: ['{arrival}! Legend 🍻', 'Oh here we go 😂', 'Look what the cat dragged in', 'Get {arrival} a drink!', 'Now it’s a party', '{arrival} 😂😂', 'Yes {arrival}!'],
  arrivalMully: ['Didn’t get the memo, Mully? 😂', 'Mully mate. It was in the group chat.', 'Of course Mully came as Mully'],
  cheryl: ['Geez that was a bit stiff 😅', 'Where are they even racing today?? 🤷', 'Cheers Cheryl 🍻', 'Righto, who’s first?', 'Someone get a round in', 'Love Cheryl'],
  selected: ['Oh no, not {bettor} 😂', '{bettor}! No pressure mate', 'Go on {bettor}, make us proud', 'We’re doomed 😅', 'Bring us home {bettor}', 'Here we go…'],
  away: ['And they’re off. 🏇', 'Reckon {bettor} actually knows what they’re doing in there?', 'What’s {bettor} doing?', 'Picking the bet mate. That’s... that’s the whole thing we’re doing here.',
    '🤔', 'Oi but seriously though. What do we reckon {bettor}’s gonna come back with?', 'Hopefully not another greyhound.', 'Five bucks says it’s the favourite.', '{bettor} is definitely ringing someone', 'Here we go 😂'],
  bell: ['Oi... who was that 👀', 'What WAS that??', 'Someone’s got a tip.', '{name}. {name} that you? 🤨', 'Sharing’s caring, mate.', 'SHARING IS CARING', 'Who’s got a tip??', 'Ohhhh 👀👀'],
  denied: ['Wasn’t me 😇', 'No comment.', '🤐', 'I’m not saying anything', 'Mind ya business 😂'],
  back: ['{bettor}’s back! 👀', 'Get around ’em! 🏇', 'We in the money or what???', 'Well? WELL??', 'Face says favourite.', 'Don’t keep us waiting {bettor}'],
  drum: ['🥁🥁🥁', 'DRUM ROLL', '🥁'],
  reveal: ['LET’S GO WE’RE ON 🏇', '{runner} at ${odds}? Bold.', 'Love it.', 'I can work with that', '{runner}!! Get on!', 'Not mad at it'],
  revealEachWay: ['Each way… playing with a straight bat early, {bettor}.', 'What’s an each way?', 'Means we get paid if it places. Not just wins.'],
  revealRoughie: ['That’s a roughie 😬', '{odds}?? We’re going to the moon or nowhere', 'Bold call {bettor}. Bold.'],
  revealFav: ['Favourite. Boring but I’ll take it.', 'Safe as houses 🏠', 'Straight bat, love it'],
  revealSelf: ['Just went for a bit of value, see how we go 🍌', 'Trust the process', 'I’ve got a feeling about this one', 'Don’t @ me if it loses'],
  jump: ['HERE WE GO 🏇🏇🏇', 'Which one are we??', 'Come on {runner}!!', 'Lets actually go!!!', 'NOBODY TALK TO ME', '🤞🤞🤞'],
  leading: ['{runner}’s up there!!', 'IS THAT US!!!', 'Here we go!! KICK!! 🏇', 'Get Legs!!', 'HOLD ON!!'],
  trailing: ['Boxed in a bit…', 'Still time still time…', 'Not looking good 😬', 'Come ONNNN', 'Room on the outside…'],
  win: ['YES YOU LITTLE BEAUTY 🏇🏇', 'GO YOU GOOD THING', 'WE WON?? WE ACTUALLY WON???', '{bettor} you LEGEND', 'Drinks on {bettor}! 🍻', 'In the black 👊'],
  placed: ['We’ll take the place! Each way pays', 'We placed! You’re in the money! 💰', 'What does placed mean', 'It means we didn’t lose 😅', 'Gnome complaints from me'],
  lose: ['Ohhh no.', 'Next one, next one.', '{bettor}… mate.', 'Bin it 🗑️', 'We go again.', 'Unlucky {bettor}', 'Never back the {no}…'],
  leave: ['Sorry lads, misso just called, gotta grab her from work… happy punting 🤙', 'That’s me, early start tomorrow. Happy punting 🤙', 'Righto I’m out, good luck you lot 🍻'],
  afterLeave: ['Loved us and left us 💔', 'Took the money and ran', 'When duty calls…', 'And then there were {count}…', 'Mate ??'],
  reply: ['😂', 'Fair call', 'Ha!', 'Settle down {name}', '😂😂😂', 'Facts.', '👀', 'You’re not wrong'],
  vote: ['Already?? 😩', 'Fair enough, I’m in', 'Let it ride!', 'One more…', 'Yeah I’m cooked'],
};

// Characters with an established voice get their own lines (from the prototype script).
const CHARACTER_BANTER = {
  mankini_maverick: {
    cheryl: ['My uncle’s a bookie and he’s given me a sure thing in the 3rd at Doomben if anyone’s keen?'],
    away: ['I’ll tell you what they should be doing. Calling my uncle Tom.', 'Uncle Tom is the punt, mate. Bloke hasn’t paid for a round in four years.'],
    bell: ['Who’s got a tip?? Uncle Tom’s been quiet all morning and now THIS?'],
    revealEachWay: ['Uncle Tom never goes each way. Just saying.'],
    lose: ['Uncle Tom does say ‘Never back the {no}…’.', 'Uncle Tom had a different one by the way. Just… putting that out there.'],
    reply: ['Hold up, just got a text from Uncle Tom!'],
  },
  grant_the_gnome: {
    selected: ['Gnome pressure {bettor} 🎩'], away: ['Gnome turning back now.', 'Tommo on the punt too is he? 🎣'], denied: ['Gnome way I’m telling 🎣'],
    back: ['Gnome place we’d rather be 🎩'], reveal: ['Gnome stopping us now 🎩'], jump: ['They’re about to jump 🎩'], placed: ['Gnome complaints from me 🎩'], win: ['GO YOU GOOD THING 🎩🎩'],
  },
  bin_chicken: {
    cheryl: ['Where are they even racing today?? 🤷'], away: ['What’s {bettor} doing?', '🤔'], bell: ['What WAS that??'], revealEachWay: ['What’s an each way?'],
    jump: ['Which one are we??'], placed: ['What does placed mean', 'Wait… did we win or not??'], win: ['WE WON?? WE ACTUALLY WON???'], reply: ['What’s happening??'],
  },
  mully: {
    cheryl: ['Geez that was a bit stiff 😅'], back: ['They’re back! 👀'], jump: ['HERE WE GO 🏇🏇🏇', 'NOBODY TALK TO ME'], win: ['YES YOU LITTLE BEAUTY 🏇🏇', 'We’re alive. In the black 👊'],
    bell: ['Oi... who was that 👀', '{name}. {name} that you? 🤨'], afterLeave: ['Loved us and left us 💔', 'Mate ??'],
  },
  tyler_the_tradie: {
    away: ['Reckon {bettor} actually knows what they’re doing in there?'], bell: ['Someone’s got a tip.', 'Sharing’s caring, mate.'], back: ['Get around ’em! 🏇'],
    revealEachWay: ['Means we get paid if it places. Not just wins.'], trailing: ['Boxed in a bit…'], leave: ['Sorry lads, misso just called, gotta grab her from work… happy punting 🤙'],
  },
  banana: { revealSelf: ['Just went for a bit of value, see how we go 🍌'], jump: ['Come ONNNN 🍌'], placed: ['Well… second. Each way pays though 🍌'] },
  big_baby: { win: ['Bottle’s on me 🍼'] }, pirate: { win: ['ARRRR WE’RE RICH'], lose: ['Walk the plank, {runner}'] }, spartan_warrior: { jump: ['THIS IS SPARTAAAA 🏇'] },
  mad_scientist: { reveal: ['Statistically… yes. Emotionally… also yes.'], lose: ['As my models predicted.'] }, silly_goose: { reply: ['Honk.'] }, emu: { reply: ['Bock.'] },
};

module.exports = { CHERYL, BANTER, CHARACTER_BANTER };
