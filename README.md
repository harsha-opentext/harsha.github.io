# Git-Base v2 - Dynamic Schema Tracker

A sophisticated web app for tracking data with GitHub as the backend storage. Features dynamic schema definition, JSON storage, and configurable settings.

## Features

### 🔧 Configuration System
- **config.js**: Default configuration with localStorage overrides
- **Browser Storage**: Settings persist in localStorage (no need to re-enter credentials)
- **Configurable Data File**: Change where data is stored in your GitHub repo

### 📊 Dynamic Schema
- **schema.yaml**: Define your data structure in YAML
- **Auto-generated Forms**: Input fields are created based on schema
- **Field Types Supported**:
  - `text`: Text input
  - `number`: Numeric input with min/max
  - `date`: Date picker with default "today"
  - `select`: Dropdown with predefined options
- **Custom Display Format**: Define how entries are displayed
- **Configurable Totals**: Specify which field to sum

### 💾 Better Data Storage
- **JSON Format**: Structured data storage instead of CSV
- **Flexible Schema**: Add/remove fields without code changes
- **Type Safety**: Proper number parsing and validation

### 🔐 Security
- **GitHub Personal Access Token**: Secure authentication
- **Private Repos Supported**: Store sensitive data privately
- **Bearer Token Auth**: Proper CORS-compatible authentication

## Setup

1. **Create a GitHub Personal Access Token**
   - Go to https://github.com/settings/tokens
   - Generate new token with `repo` scope
   - Copy the token (starts with `ghp_`)

2. **Configure the App**
   - Click "⚙️ API CONFIG"
   - Enter your token and repo path (e.g., `username/repo-name`)
   - Click "Save & Connect"
   - Credentials are saved in browser storage

3. **Customize Schema** (Optional)
   - Edit `schema.yaml` to define your own data structure
   - Add/modify fields as needed
   - Change display format and total field

4. **Configure Settings** (Optional)
   - Edit `config.js` to change defaults
   - Modify `dataFile` to use a different filename
   - Adjust UI settings like theme and log retention

## Usage

1. **Add Data**: Fill in the form fields and click "Add Locally"
2. **Fetch from GitHub**: Click "Fetch Git" to load existing data
3. **Save to GitHub**: Click "Push to GitHub" to sync
4. **View Logs**: Click "📋 LOGS" to see debug information
5. **Delete Entries**: Click "Delete" button on any entry

## Schema Example

```yaml
schema:
  name: "expense_tracker"
  displayName: "Expense Tracker"
  fields:
    - name: "date"
      type: "date"
      label: "Date"
      required: true
      default: "today"
    - name: "description"
      type: "text"
      label: "Description"
      required: true
    - name: "amount"
      type: "number"
      label: "Amount ($)"
      required: true
      min: 0
    - name: "category"
      type: "select"
      label: "Category"
      options:
        - "Food"
        - "Transport"
        - "Entertainment"
        - "Other"
  totalField: "amount"
  displayFormat: "{description} - ${amount}"
```

## Local Development

```bash
# Start local server
python3 -m http.server 8000

# Open in browser
open http://localhost:8000
```

## Deployment

Push to GitHub Pages:
```bash
git add .
git commit -m "Update app"
git push origin main
```

The app will be available at `https://username.github.io/repo-name/`

## Configuration Options

### config.js
- `dataFile`: Filename in repo for data storage (default: `data.json`)
- `schemaFile`: Schema definition file (default: `schema.yaml`)
- `dateFormat`: Date format for display
- `autoFetch`: Auto-load data on startup
- `showLogs`: Show log panel by default
- `logRetentionMinutes`: How long to keep logs

## Browser Compatibility

Works in all modern browsers:
- Chrome/Edge
- Firefox
- Safari
- Mobile browsers (iOS/Android)

## PWA Support

Add to home screen on mobile devices for app-like experience with persistent credentials.
