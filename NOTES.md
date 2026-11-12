# RegioJet API notes

Base: `https://brn-ybus-pubapi.sa.cz/restapi`. Required headers: `X-Lang: cs`, `X-Currency: CZK`,
`X-Application-Origin: WEB`. POST bodies need `Content-Type: application/1.1.0+json`; plain
`application/json` returns 400 `request.body.json.property.unrecognized`.

- `GET /consts/locations`: countries with `cities[]` (`id`, `name`).
- `GET /routes/search/simple?tariffs=REGULAR&fromLocationType=CITY&fromLocationId=..&toLocationType=CITY&toLocationId=..&departureDate=YYYY-MM-DD`
  returns routes for that day and the following ones.
- `GET /routes/{id}/simple?fromStationId=..&toStationId=..&tariffs=REGULAR`: `predictedDepartureTime` (delay).
- `POST /routes/freeSeats` with `{"sections":[{"sectionId","fromStationId","toStationId"}],"seatPreference":{"tariffs":["REGULAR"]}}`
  returns vehicles with `number`, `seatClasses[0].name` and `decks[0].freeSeats[].index`.

## Cart flow (no login needed)

`/reservation/seating/there?routeId=..&fromStationId=..&toStationId=..&seatClassKey=..` plus one
`tariffs=REGULAR` per seat. Pick the car with the "Vagón číslo N." button; seats are SVG groups `g#s<N>`;
a click replaces one of the preselected seats. "Pokračovat" leads to `/reservation/addons/there`,
where the seats are in the cart.

## Not verified

Delayed trains, sleeper/Business cars, how long the cart hold lasts, whether the seating URL can be
reopened to rebuild an expired cart (the "retry" button relies on it).
