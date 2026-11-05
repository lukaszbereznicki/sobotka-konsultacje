let DATA = null;
let ROUTE_GEOMETRIES = null;
let RAIL_DATA = null;
const $ = (id) => document.getElementById(id);
const byId = (a, k) => Object.fromEntries(a.map((x) => [x[k], x]));
let STOPS = {},
  ROUTES = {},
  TRIPS = {},
  TIMES = {};
let TRANSPORT_MAP = null;
let ROUTE_LAYER = null;
let EXACT_ROUTE_LAYER = null;
let GENERATED_ROUTE_LAYERS = {};
let STOP_LAYER = null;
let RAIL_STATION_LAYER = null;

let LINE_LAYERS = {
  61: null,
  62: null,
  63: null,
  64: null,
};

async function init() {
  const [transportData, routeGeometries, railData] = await Promise.all([
    fetch("sobotka_transport.json").then((response) => response.json()),

    fetch("route_geometries.json").then((response) => response.json()),

    fetch("rail_schedule.json").then((response) => response.json()),
  ]);

  DATA = transportData;
  ROUTE_GEOMETRIES = routeGeometries;
  RAIL_DATA = railData;
  STOPS = byId(DATA.stops, "stopId");
  ROUTES = byId(DATA.routeVariants, "routeVariantId");
  TRIPS = byId(DATA.physicalTrips, "tripId");
  DATA.stopTimes.forEach((x) => (TIMES[x.tripId] ??= []).push(x));
  Object.values(TIMES).forEach((a) =>
    a.sort((x, y) => x.sequence - y.sequence),
  );
  fillStops();
  renderLines();
  renderStats();
  console.log("Wykryte przystanki przesiadkowe:", getTransferStops());
  console.log(
    "Przykładowe połączenia z przesiadką:",
    tripsWithTransfer("REK", "SULIC_TAP"),
  );
}

function getLinesForStop(stopId) {
  const lines = new Set();

  for (const route of DATA.routeVariants) {
    const stopExists = route.stops.some((stop) => stop.stopId === stopId);

    if (stopExists) {
      lines.add(route.lineId);
    }
  }

  return [...lines].sort();
}

function drawExactRoutes() {
  // Tworzymy osobną warstwę dla każdej linii.
  for (const lineId of ["61", "62", "63", "64"]) {
    if (LINE_LAYERS[lineId] && TRANSPORT_MAP.hasLayer(LINE_LAYERS[lineId])) {
      TRANSPORT_MAP.removeLayer(LINE_LAYERS[lineId]);
    }

    LINE_LAYERS[lineId] = L.layerGroup().addTo(TRANSPORT_MAP);
  }

  // Rysujemy wszystkie 8 wariantów.
  for (const route of DATA.routeVariants) {
    const geometry = ROUTE_GEOMETRIES?.routes?.[route.routeVariantId];

    if (
      !geometry ||
      geometry.type !== "LineString" ||
      !Array.isArray(geometry.coordinates)
    ) {
      console.warn(`Brak geometrii dla ${route.routeVariantId}`);

      continue;
    }

    const leafletCoordinates = geometry.coordinates.map((coordinate) => [
      coordinate[1],
      coordinate[0],
    ]);

    const line = DATA.lines.find((item) => item.lineId === route.lineId);

    const color = line?.color || "#173E35";

    const polyline = L.polyline(leafletCoordinates, {
      color: color,
      weight: 5,
      opacity: 0.85,
      pane: "routesPane",
    });

    polyline.bindPopup(`
            <div class="map-popup">

                <strong>
                    Linia ${route.lineId}
                </strong>

                <div>
                    ${route.directionName}
                </div>

                <div>
                    ${route.totalDistanceKm} km
                    ·
                    ${route.scheduledTravelTimeMin} min
                </div>

            </div>
        `);

    polyline.addTo(LINE_LAYERS[route.lineId]);
  }
}

const railStationIcon = L.divIcon({
  className: "rail-station-marker",

  html: `
        <div class="rail-station-marker-inner">
            🚆
        </div>
    `,

  iconSize: [34, 34],

  iconAnchor: [17, 17],

  popupAnchor: [0, -18],
});

function getTrainsForStation(stationId) {
  if (!RAIL_DATA?.trains) {
    return [];
  }

  return RAIL_DATA.trains.filter((train) =>
    train.localStops?.some((stop) => stop.stationId === stationId),
  );
}

function getRailDeparturesForStation(stationId) {
  const departures = [];

  const trains = getTrainsForStation(stationId);

  for (const train of trains) {
    const localStop = train.localStops.find(
      (stop) => stop.stationId === stationId,
    );

    if (!localStop) {
      continue;
    }

    departures.push({
      trainId: train.trainId,
      category: train.category,
      departureTime: localStop.departureTime,

      destination: train.destination.stationName,

      destinationArrivalTime: train.destination.arrivalTime,

      service: train.service,
    });
  }

  departures.sort(
    (a, b) => minutes(a.departureTime) - minutes(b.departureTime),
  );

  return departures;
}

function renderRailDepartures(stationId) {
  const departures = getRailDeparturesForStation(stationId);

  if (departures.length === 0) {
    return `
            <div class="rail-no-departures">
                Brak odjazdów w załadowanym rozkładzie.
            </div>
        `;
  }

  return `
        <div class="rail-departures">

            <div class="rail-departures-title">
                Odjazdy pociągów
            </div>

            ${departures
              .map(
                (departure) => `
                        <div class="rail-departure">

                            <div class="rail-departure-time">
                                ${departure.departureTime}
                            </div>

                            <div class="rail-departure-details">

                                <strong>
                                    → ${departure.destination}
                                </strong>

                                <div class="rail-departure-meta">
                                    ${
                                      departure.category
                                        ? departure.category + " · "
                                        : ""
                                    }

                                    pociąg ${departure.trainId}

                                    ${
                                      departure.destinationArrivalTime
                                        ? ` · przyjazd ${departure.destinationArrivalTime}`
                                        : ""
                                    }
                                </div>

                            </div>

                        </div>
                    `,
              )
              .join("")}

        </div>
    `;
}

function drawRailStations() {
  if (!RAIL_DATA) {
    console.error("rail_schedule.json nie został załadowany.");
    return;
  }

  if (RAIL_STATION_LAYER) {
    RAIL_STATION_LAYER.clearLayers();
  } else {
    RAIL_STATION_LAYER = L.layerGroup().addTo(TRANSPORT_MAP);
  }

  for (const station of RAIL_DATA.stations) {
    const stationTrains = getTrainsForStation(station.stationId);

    const marker = L.marker([station.location.lat, station.location.lon], {
      pane: "stopsPane",
      icon: railStationIcon,
    });

    const departuresHtml = renderRailDepartures(station.stationId);

    marker.bindPopup(
      `
        <div class="map-popup rail-popup">

            <strong class="map-stop-name">
                🚆 ${station.name}
            </strong>

            <div class="rail-operator">
                Koleje Dolnośląskie
            </div>

            ${departuresHtml}

            <div class="rail-validity">
                Rozkład:
                ${RAIL_DATA.meta.validFrom}
                –
                ${RAIL_DATA.meta.validTo}
            </div>

        </div>
    `,
      {
        maxWidth: 390,
        maxHeight: 460,
      },
    );

    marker.addTo(RAIL_STATION_LAYER);
  }
}

function toggleStops(visible) {
  if (!STOP_LAYER) {
    return;
  }

  if (visible) {
    if (!TRANSPORT_MAP.hasLayer(STOP_LAYER)) {
      STOP_LAYER.addTo(TRANSPORT_MAP);
    }
  } else {
    if (TRANSPORT_MAP.hasLayer(STOP_LAYER)) {
      TRANSPORT_MAP.removeLayer(STOP_LAYER);
    }
  }
}

function toggleRailStations(visible) {
  if (!RAIL_STATION_LAYER) {
    return;
  }

  if (visible) {
    if (!TRANSPORT_MAP.hasLayer(RAIL_STATION_LAYER)) {
      RAIL_STATION_LAYER.addTo(TRANSPORT_MAP);
    }
  } else {
    if (TRANSPORT_MAP.hasLayer(RAIL_STATION_LAYER)) {
      TRANSPORT_MAP.removeLayer(RAIL_STATION_LAYER);
    }
  }
}

function toggleLine(lineId, visible) {
  const layer = LINE_LAYERS[lineId];

  if (!layer) {
    return;
  }

  if (visible) {
    if (!TRANSPORT_MAP.hasLayer(layer)) {
      layer.addTo(TRANSPORT_MAP);
    }
  } else {
    if (TRANSPORT_MAP.hasLayer(layer)) {
      TRANSPORT_MAP.removeLayer(layer);
    }
  }
}

async function loadRouteGeometry(routeVariantId) {
  const route = ROUTES[routeVariantId];

  if (!route) {
    console.error(`Nie znaleziono routeVariant ${routeVariantId}`);
    return null;
  }

  const coordinates = route.stops.map((routeStop) => {
    const stop = STOPS[routeStop.stopId];

    if (!stop?.location) {
      throw new Error(`Brak współrzędnych przystanku ${routeStop.stopId}`);
    }

    return `${stop.location.lon},${stop.location.lat}`;
  });

  const url =
    "https://router.project-osrm.org/route/v1/driving/" +
    coordinates.join(";") +
    "?overview=full&geometries=geojson&steps=false";

  console.log(`Pobieram geometrię ${routeVariantId}...`);

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Błąd OSRM dla ${routeVariantId}: ${response.status}`);
  }

  const data = await response.json();

  if (data.code !== "Ok" || !data.routes || data.routes.length === 0) {
    throw new Error(`OSRM nie zwrócił trasy dla ${routeVariantId}`);
  }

  console.log(`Gotowa geometria ${routeVariantId}`);

  return data.routes[0].geometry;
}

async function generateRemainingRouteGeometries() {
  const routeIds = ["61_T", "61_P", "62_T", "62_P", "63_T", "64_T", "64_P"];

  const result = {};

  for (const routeVariantId of routeIds) {
    try {
      const geometry = await loadRouteGeometry(routeVariantId);

      if (geometry) {
        result[routeVariantId] = geometry;

        drawGeneratedGeometry(routeVariantId, geometry);
      }
    } catch (error) {
      console.error(`Błąd przy ${routeVariantId}:`, error);
    }
  }

  console.log("POZOSTAŁE GEOMETRIE:", JSON.stringify(result, null, 2));

  return result;
}

function drawGeneratedGeometry(routeVariantId, geometry) {
  const route = ROUTES[routeVariantId];

  if (!route || !geometry) {
    return;
  }

  const coordinates = geometry.coordinates.map((coordinate) => [
    coordinate[1],
    coordinate[0],
  ]);

  const line = DATA.lines.find((item) => item.lineId === route.lineId);

  if (GENERATED_ROUTE_LAYERS[routeVariantId]) {
    TRANSPORT_MAP.removeLayer(GENERATED_ROUTE_LAYERS[routeVariantId]);
  }

  GENERATED_ROUTE_LAYERS[routeVariantId] = L.polyline(coordinates, {
    color: line?.color || "#173E35",

    weight: 6,
    opacity: 0.9,
    pane: "routesPane",
  });

  GENERATED_ROUTE_LAYERS[routeVariantId].addTo(TRANSPORT_MAP).bindPopup(`
            <div class="map-popup">
                <strong>
                    Linia ${route.lineId}
                </strong>

                <div>
                    ${route.directionName}
                </div>

                <div>
                    geometria OSRM
                </div>
            </div>
        `);
}
function initializeTransportMap() {
  /*
   * Nie tworzymy mapy ponownie,
   * jeżeli została już utworzona.
   */
  if (TRANSPORT_MAP) {
    TRANSPORT_MAP.invalidateSize();
    return;
  }

  /*
   * Tworzymy mapę.
   * Początkowy widok jest tylko punktem startowym,
   * ponieważ później fitBounds dopasuje mapę
   * do wszystkich przystanków.
   */
  TRANSPORT_MAP = L.map("transportMap");
  STOP_LAYER = L.layerGroup().addTo(TRANSPORT_MAP);
  TRANSPORT_MAP.createPane("routesPane");
  TRANSPORT_MAP.getPane("routesPane").style.zIndex = 350;

  TRANSPORT_MAP.createPane("stopsPane");
  TRANSPORT_MAP.getPane("stopsPane").style.zIndex = 450;

  /*
   * Podkład OpenStreetMap.
   */
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,

    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">' +
      "OpenStreetMap contributors</a>",
  }).addTo(TRANSPORT_MAP);

  const markerCoordinates = [];

  /*
   * Tworzymy marker dla każdego przystanku.
   */
  for (const stop of DATA.stops) {
    if (!stop.location) {
      continue;
    }

    const lat = stop.location.lat;
    const lon = stop.location.lon;

    markerCoordinates.push([lat, lon]);

    /*
     * Informacja o PKP.
     */
    let railwayInfo = "";

    if (stop.railConnection?.available) {
      railwayInfo = `
                <div class="map-rail-info">

                    <strong>
                        🚆 Dostęp do kolei
                    </strong>

                    <br>

                    Stacja:
                    ${stop.railConnection.stationName}

                    <br>

                    ${stop.railConnection.walkingDistanceMeters} m
                    · ok.
                    ${stop.railConnection.walkingTimeMinutes} min pieszo

                </div>
            `;
    }

    /*
     * Linie obsługujące przystanek.
     */
    const lines = getLinesForStop(stop.stopId);

    const popup = `
            <div class="map-popup">

                <strong class="map-stop-name">
                    ${stop.name}
                </strong>

                <div>
                    Linie:
                    <strong>
                        ${lines.join(", ")}
                    </strong>
                </div>

                ${railwayInfo}

            </div>
        `;

    L.marker([lat, lon], {
      pane: "stopsPane",
    })
      .addTo(STOP_LAYER)
      .bindPopup(popup);
  }

  /*
   * Automatycznie ustawiamy mapę tak,
   * żeby wszystkie przystanki były widoczne.
   */
  if (markerCoordinates.length > 0) {
    TRANSPORT_MAP.fitBounds(markerCoordinates, {
      padding: [30, 30],
    });
  }
  drawExactRoutes();
  drawRailStations();
}

async function toggleMapFullscreen() {
    const container =
        document.getElementById("mapFullscreenContainer");

    if (!document.fullscreenElement) {
        try {
            await container.requestFullscreen();
        } catch (error) {
            console.error(
                "Nie udało się uruchomić trybu pełnoekranowego:",
                error
            );
        }
    } else {
        await document.exitFullscreen();
    }
}

document.addEventListener(
    "fullscreenchange",
    () => {
        if (TRANSPORT_MAP) {
            setTimeout(
                () => {
                    TRANSPORT_MAP.invalidateSize();
                },
                100
            );
        }
    }
);

function getStopDisplayName(stop) {
  if (stop.railConnection?.available) {
    return `🚆 ${stop.name}`;
  }

  return stop.name;
}

function fillStops() {
  const opts = DATA.stops
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name, "pl"))
    .map(
      (stop) =>
        `<option value="${stop.stopId}">
                    ${getStopDisplayName(stop)}
                </option>`,
    )
    .join("");

  [
    "origin",
    "destination",
    "myStop",
    "feedbackOrigin",
    "feedbackDestination",
  ].forEach((id) => {
    $(id).innerHTML = '<option value="">Wybierz przystanek…</option>' + opts;
  });
}

function minutes(t) {
  let [a, b] = t.split(":").map(Number);
  return a * 60 + b;
}
function diff(a, b) {
  let d = minutes(b) - minutes(a);
  return d < 0 ? d + 1440 : d;
}
function getTransferStops() {
  const stopLines = {};

  // Przechodzimy przez wszystkie warianty tras
  for (const route of DATA.routeVariants) {
    for (const routeStop of route.stops) {
      // Dla każdego przystanku tworzymy zbiór linii
      if (!stopLines[routeStop.stopId]) {
        stopLines[routeStop.stopId] = new Set();
      }

      // Set zapobiega wielokrotnemu dodaniu tej samej linii
      stopLines[routeStop.stopId].add(route.lineId);
    }
  }

  // Zostawiamy tylko przystanki obsługiwane
  // przez więcej niż jedną linię
  return Object.entries(stopLines)
    .filter(([stopId, lines]) => lines.size > 1)
    .map(([stopId, lines]) => ({
      stopId: stopId,
      name: STOPS[stopId]?.name ?? stopId,
      lines: [...lines].sort(),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "pl"));
}

function isTransferStop(stopId) {
  return getTransferStops().some(
    (transferStop) => transferStop.stopId === stopId,
  );
}

function tripsBetween(a, b) {
  let out = [];
  for (const t of DATA.physicalTrips) {
    let rows = TIMES[t.tripId] || [],
      ia = rows.findIndex((x) => x.stopId === a),
      ib = rows.findIndex((x) => x.stopId === b);
    if (ia >= 0 && ib > ia) {
      out.push({
        trip: t,
        from: rows[ia],
        to: rows[ib],
        duration: diff(rows[ia].departureTime, rows[ib].departureTime),
        route: ROUTES[t.routeVariantId],
      });
    }
  }
  return out.sort(
    (x, y) => minutes(x.from.departureTime) - minutes(y.from.departureTime),
  );
}

function tripsWithTransfer(originId, destinationId) {
  const connections = [];

  const MIN_TRANSFER_TIME = 3;
  const MAX_TRANSFER_TIME = 45;

  for (const firstTrip of DATA.physicalTrips) {
    const firstRoute = ROUTES[firstTrip.routeVariantId];
    const firstTripTimes = TIMES[firstTrip.tripId] || [];

    const originIndex = firstTripTimes.findIndex(
      (item) => item.stopId === originId,
    );

    if (originIndex === -1) {
      continue;
    }

    // Szukamy potencjalnego przystanku przesiadkowego
    // znajdującego się dalej na trasie pierwszego autobusu.
    for (
      let transferIndex = originIndex + 1;
      transferIndex < firstTripTimes.length;
      transferIndex++
    ) {
      const transferStopId = firstTripTimes[transferIndex].stopId;

      if (!isTransferStop(transferStopId)) {
        continue;
      }

      if (transferStopId === destinationId) {
        continue;
      }

      const firstArrivalTime = firstTripTimes[transferIndex].departureTime;

      for (const secondTrip of DATA.physicalTrips) {
        const secondRoute = ROUTES[secondTrip.routeVariantId];

        // Nie traktujemy zmiany kursu tej samej linii
        // jako sensownej przesiadki.
        if (firstRoute.lineId === secondRoute.lineId) {
          continue;
        }

        const secondTripTimes = TIMES[secondTrip.tripId] || [];

        const transferDepartureIndex = secondTripTimes.findIndex(
          (item) => item.stopId === transferStopId,
        );

        const destinationIndex = secondTripTimes.findIndex(
          (item) => item.stopId === destinationId,
        );

        // Drugi autobus musi:
        // 1. zatrzymywać się na węźle,
        // 2. później dojeżdżać do celu.
        if (
          transferDepartureIndex === -1 ||
          destinationIndex === -1 ||
          destinationIndex <= transferDepartureIndex
        ) {
          continue;
        }

        const secondDepartureTime =
          secondTripTimes[transferDepartureIndex].departureTime;

        const transferTime = diff(firstArrivalTime, secondDepartureTime);

        if (
          transferTime < MIN_TRANSFER_TIME ||
          transferTime > MAX_TRANSFER_TIME
        ) {
          continue;
        }

        const originTime = firstTripTimes[originIndex].departureTime;

        const destinationTime = secondTripTimes[destinationIndex].departureTime;

        connections.push({
          type: "transfer",

          from: {
            stopId: originId,
            departureTime: originTime,
          },

          to: {
            stopId: destinationId,
            departureTime: destinationTime,
          },

          transfer: {
            stopId: transferStopId,
            arrivalTime: firstArrivalTime,
            departureTime: secondDepartureTime,
            waitingTime: transferTime,
          },

          firstLeg: {
            trip: firstTrip,
            route: firstRoute,
          },

          secondLeg: {
            trip: secondTrip,
            route: secondRoute,
          },

          duration: diff(originTime, destinationTime),
        });
      }
    }
  }

  return connections;
}

function searchConnections() {
  const a = $("origin").value;
  const b = $("destination").value;

  const ref = `${$("desiredHour").value}:${$("desiredMinute").value}`;

  const mode = $("timeMode").value;

  if (!a || !b) {
    $("results").innerHTML =
      '<div class="warning">Wybierz przystanek początkowy i docelowy.</div>';
    return;
  }

  if (a === b) {
    $("results").innerHTML =
      '<div class="warning">Wybierz dwa różne przystanki.</div>';
    return;
  }

  /*
   * 1. Połączenia bezpośrednie
   */
  const directConnections = tripsBetween(a, b).map((connection) => ({
    type: "direct",

    from: connection.from,
    to: connection.to,

    trip: connection.trip,
    route: connection.route,

    duration: connection.duration,
  }));

  /*
   * 2. Połączenia z jedną przesiadką
   */
  const transferConnections = tripsWithTransfer(a, b);

  /*
   * 3. Jedna wspólna lista wyników
   */
  let rows = [...directConnections, ...transferConnections];

  /*
   * 4. Pozostawiamy obecny sposób sortowania:
   *
   * - departure: najbliższa godzina odjazdu
   * - arrival:   najbliższa godzina dojazdu
   */
  if (mode === "departure") {
    rows.sort(
      (x, y) =>
        Math.abs(minutes(x.from.departureTime) - minutes(ref)) -
        Math.abs(minutes(y.from.departureTime) - minutes(ref)),
    );
  } else {
    rows.sort(
      (x, y) =>
        Math.abs(minutes(x.to.departureTime) - minutes(ref)) -
        Math.abs(minutes(y.to.departureTime) - minutes(ref)),
    );
  }

  /*
   * 5. Renderowanie wyników
   */
  if (rows.length === 0) {
    $("results").innerHTML =
      '<div class="warning">Projekt nie przewiduje połączenia spełniającego wybrane kryteria.</div>';

    return;
  }

  $("results").innerHTML = rows
    .slice(0, 8)
    .map((connection) => {
      if (connection.type === "transfer") {
        return renderTransferConnection(connection);
      }

      return renderDirectConnection(connection);
    })
    .join("");
}

function renderDirectConnection(connection) {
  const lineId = connection.route.lineId;

  const line = DATA.lines.find((item) => item.lineId === lineId);

  return `
        <div class="trip">

            <div>
                <span
                    class="linebadge"
                    style="background:${line?.color || "#16493b"}"
                >
                    ${lineId}
                </span>

                <strong>Połączenie bezpośrednie</strong>
            </div>

            <div class="time">
                ${connection.from.departureTime}
                →
                ${connection.to.departureTime}
            </div>

            <div>
                ${STOPS[connection.from.stopId].name}
                →
                ${STOPS[connection.to.stopId].name}
            </div>

            <small>
                ${connection.duration} min
                ·
                ${connection.route.directionName}
            </small>

        </div>
    `;
}

function renderTransferConnection(connection) {
  const firstLineId = connection.firstLeg.route.lineId;

  const secondLineId = connection.secondLeg.route.lineId;

  const firstLine = DATA.lines.find((item) => item.lineId === firstLineId);

  const secondLine = DATA.lines.find((item) => item.lineId === secondLineId);

  const transferStop = STOPS[connection.transfer.stopId];

  return `
        <div class="trip">

            <div>
                <strong>1 przesiadka</strong>
            </div>

            <div class="time">
                ${connection.from.departureTime}
                →
                ${connection.to.departureTime}
            </div>


            <div class="connection-leg">

                <span
                    class="linebadge"
                    style="background:${firstLine?.color || "#16493b"}"
                >
                    ${firstLineId}
                </span>

                <strong>
                    ${connection.from.departureTime}
                </strong>

                ${STOPS[connection.from.stopId].name}

            </div>


            <div class="transfer-box">

                <strong>
                    Przesiadka:
                    ${transferStop.name}
                </strong>

                <br>

                przyjazd:
                ${connection.transfer.arrivalTime}

                · odjazd:
                ${connection.transfer.departureTime}

                <br>

                czas na przesiadkę:
                <strong>
                    ${connection.transfer.waitingTime} min
                </strong>

            </div>


            <div class="connection-leg">

                <span
                    class="linebadge"
                    style="background:${secondLine?.color || "#16493b"}"
                >
                    ${secondLineId}
                </span>

                <strong>
                    ${connection.transfer.departureTime}
                </strong>

                ${transferStop.name}

                →

                ${STOPS[connection.to.stopId].name}

            </div>


            <small>
                Łączny czas podróży:
                ${connection.duration} min
            </small>

        </div>
    `;
}

function showStop() {
  let sid = $("myStop").value;

  if (!sid) {
    $("stopResults").innerHTML = "";
    return;
  }

  const stop = STOPS[sid];

  let deps = [];

  for (const t of DATA.physicalTrips) {
    let x = (TIMES[t.tripId] || []).find((z) => z.stopId === sid);

    if (x) {
      let r = ROUTES[t.routeVariantId];

      deps.push({
        time: x.departureTime,
        line: r.lineId,
        dest: STOPS[r.destinationStopId]?.name || r.directionName,
        escort: t.service.schoolDayEscort?.enabled,
      });
    }
  }

  deps.sort((a, b) => minutes(a.time) - minutes(b.time));

  /*
   * Informacja o kolei.
   * Powstaje tylko w przypadku przystanku
   * posiadającego railConnection w JSON.
   */
  let railInfo = "";

  if (stop.railConnection?.available) {
    railInfo = `
            <div class="rail-info">
                <strong>🚆 Dostęp do kolei</strong>

                <div>
                    Stacja PKP:
                    <strong>
                        ${stop.railConnection.stationName}
                    </strong>
                </div>

                <div>
                    ${stop.railConnection.walkingDistanceMeters} m
                    · ok.
                    ${stop.railConnection.walkingTimeMinutes} min pieszo
                </div>
            </div>
        `;
  }

  /*
   * Budujemy cały widok przystanku.
   */
  $("stopResults").innerHTML = `
        <h3>${stop.name}</h3>

        ${railInfo}

        <h4>Projektowane odjazdy</h4>

        ${deps
          .map(
            (x) => `
                    <div class="stop-card">

                        <b>${x.time}</b>

                        <span
                            class="linebadge"
                            style="background:${
                              DATA.lines.find((l) => l.lineId === x.line)
                                ?.color || "#16493b"
                            }"
                        >
                            ${x.line}
                        </span>

                        → ${x.dest}

                        ${
                          x.escort
                            ? "<small> · opieka w dni nauki szkolnej</small>"
                            : ""
                        }

                    </div>
                `,
          )
          .join("")}
    `;
}

function renderLines() {
  let host = $("lines");
  host.innerHTML = DATA.routeVariants
    .map(
      (r) =>
        `<div class="routeCard" onclick="showSchedule('${r.routeVariantId}')"><span class="linebadge" style="background:${DATA.lines.find((l) => l.lineId === r.lineId)?.color || "#16493b"}">${r.lineId}</span><b>${r.directionName}</b><div class="muted">${r.stops.length} przystanków · ${r.totalDistanceKm} km · ${r.scheduledTravelTimeMin} min</div></div>`,
    )
    .join("");
}

function showSchedule(rid) {
  let r = ROUTES[rid];

  let ts = DATA.physicalTrips.filter((t) => t.routeVariantId === rid);

  let h = `
        <h3>${r.directionName}</h3>

        <div class="schedule">
            <table>
                <tr>
                    <th>Przystanek</th>

                    ${ts
                      .map(
                        (t) =>
                          `<th>
                                    ${TIMES[t.tripId]?.[0]?.departureTime}
                                </th>`,
                      )
                      .join("")}
                </tr>
    `;

  for (const s of r.stops) {
    const stop = STOPS[s.stopId];

    /*
     * Ikona pojawia się tylko przy przystankach
     * posiadających połączenie z koleją.
     */
    const railIcon = stop.railConnection?.available
      ? `<span
                       class="rail-icon"
                       title="Dostęp do stacji PKP: ${stop.railConnection.stationName}"
                       aria-label="Dostęp do stacji PKP ${stop.railConnection.stationName}"
                   >🚆</span>`
      : "";

    h += `
            <tr>
                <td>
                    ${stop.name}
                    ${railIcon}
                </td>

                ${ts
                  .map(
                    (t) =>
                      `<td>
                                ${
                                  (TIMES[t.tripId] || []).find(
                                    (x) => x.stopId === s.stopId,
                                  )?.departureTime || ""
                                }
                            </td>`,
                  )
                  .join("")}
            </tr>
        `;
  }

  h += `
            </table>
        </div>
    `;

  $("schedule").innerHTML = h;
}

function renderStats() {
  $("stats").innerHTML =
    `<div class="stat"><b>${DATA.lines.length}</b>linie</div><div class="stat"><b>${DATA.stops.length}</b>przystanków</div><div class="stat"><b>${DATA.routeVariants.length}</b>kierunków</div><div class="stat"><b>${DATA.physicalTrips.length}</b>fizyczne kursy</div>`;
}
let selectedProblems = new Set();
function toggleProblem(el, v) {
  selectedProblems.has(v)
    ? selectedProblems.delete(v)
    : selectedProblems.add(v);
  el.classList.toggle("active");
}
function saveFeedback() {
  let assessment = document.querySelector(
    "input[name=assessment]:checked",
  )?.value;
  if (!$("feedbackOrigin").value || !assessment) {
    $("feedbackStatus").innerHTML =
      '<div class="warning">Wybierz swój przystanek/miejsce startu i oceń projekt.</div>';
    return;
  }
  let obj = {
    responseId: "RESP_" + Date.now(),
    createdAt: new Date().toISOString(),
    origin: {
      stopId: $("feedbackOrigin").value,
      locality: STOPS[$("feedbackOrigin").value]?.locality,
    },
    destination: {
      stopId: $("feedbackDestination").value || null,
      locality: STOPS[$("feedbackDestination").value]?.locality || null,
    },
    need: {
      direction: $("feedbackMode").value,
      desiredTime: $("feedbackTime").value || null,
      purpose: $("purpose").value || null,
    },
    evaluatedTripIds: $("feedbackDestination").value
      ? tripsBetween(
          $("feedbackOrigin").value,
          $("feedbackDestination").value,
        ).map((x) => x.trip.tripId)
      : [],
    assessment,
    problems: [...selectedProblems],
    preferredTime: $("preferredTime").value || null,
    comment: $("comment").value.trim(),
  };
  let all = JSON.parse(localStorage.getItem("sobotkaConsultation") || "[]");
  all.push(obj);
  localStorage.setItem("sobotkaConsultation", JSON.stringify(all));
  $("feedbackStatus").innerHTML =
    '<div class="success">Opinia została zapisana lokalnie w tej przeglądarce. W wersji produkcyjnej w tym miejscu odpowiedź trafiłaby do systemu konsultacji.</div>';
}
function exportFeedback() {
  let all = localStorage.getItem("sobotkaConsultation") || "[]",
    blob = new Blob([all], { type: "application/json" }),
    a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "consultation_responses.json";
  a.click();
  URL.revokeObjectURL(a.href);
}
function tab(id, btn) {
  document
    .querySelectorAll(".view")
    .forEach((x) => x.classList.remove("active"));
  document
    .querySelectorAll(".tabs button")
    .forEach((x) => x.classList.remove("active"));
  $(id).classList.add("active");
  btn.classList.add("active");
  if (id === "mapView") {
    setTimeout(() => {
      initializeTransportMap();
    }, 0);
  }
}
init();
