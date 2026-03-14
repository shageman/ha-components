# Location History Card

A custom Home Assistant Lovelace card that displays GPS history tracks for multiple entities on an interactive map with time range controls.

## Features

- Interactive Leaflet map with multiple GPS tracks
- Time range presets (1h, 2h, 6h, 12h, 24h, 7d, 14d, 30d, 90d, 180d, 365d)
- Native HA date range picker for custom time windows
- Per-entity color coding with toggle visibility
- Client-side downsampling to handle large datasets
- Start/end markers with popups showing timestamps
- Auto-fits map bounds to visible tracks

## Installation (HACS)

1. Open HACS in Home Assistant
2. Go to **Frontend** → three-dot menu → **Custom repositories**
3. Add this repo URL, category: **Dashboard**
4. Install **Location History Card**
5. Add the card to your dashboard

## Configuration

```yaml
type: custom:location-history-card
title: Location History
hours: 24
entities:
  - entity: device_tracker.my_phone
    name: Phone 1
    color: "#f39c12"
    icon: "📱"
  - entity: device_tracker.my_other_phone
    name: Phone 2
    color: "#9b59b6"
    icon: "📱"
  - entity: device_tracker.my_gps_tracker
    name: GPS Tracker
    color: "#3498db"
    icon: "📍"
```

### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `title` | string | `Location History` | Card title |
| `hours` | number | `24` | Default time range in hours |
| `entities` | list | required | List of device_tracker entities |
| `entities[].entity` | string | required | Entity ID |
| `entities[].name` | string | entity friendly name | Display name |
| `entities[].color` | string | auto | Track color (hex) |
| `entities[].icon` | string | `📍` | Emoji for current position marker |
| `min_distance` | number | `10` | Minimum meters between points (downsampling) |
