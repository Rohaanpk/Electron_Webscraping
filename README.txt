To Run the app:
1.) Open the folder 'Electron test' within vs code
2.) Select/open a js file within vscode
3.) Open a js terminal
4.) Enter the following text into the terminal (and press enter) 'npm run start'
The files are structured as followed:
Main.js - Handles the opening of the js files
/app/index.html - Main app window frontend
/app/style.css - Main app window styling
/app/style/js/index.js - Main app window backend (parent window electron js)
/app/js/preload.js - Child app window frontend/backend (frontend is just webpage accessed on parent window,
	currently locked to one webpage) (child window electron js)