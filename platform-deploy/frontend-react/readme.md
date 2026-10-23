# React Frontend

## Getting Started
### Development Environment Setup

1. make sure VPN is connected 
1. set a hostname in your "hosts" file  
   ``` 127.0.0.1 react.lqwd.tech  ```
1. set a proxy to dla  
  ``` kubectl port-forward svc/dla -n microservice 8690:8690  --address 0.0.0.0 ```
1. set a proxy to push server
  ``` kubectl port-forward svc/push-server -n microservice 7001:7001  --address 0.0.0.0 ```
1. install nginx on your local env
1. configure nginx using .nginx file in src folder
1. copy lqwdtls.crt and lqwdtls.key from keeper account to /etc/nginx/ folder
1.   ``` sudo systemctl restart nginx ```


### Installation

1- Clone the repo

2- `yarn` or `npm install` to install npm packages

3- copy .env.example to .env file and edit it based on your config 

4- start dev server using `yarn start` or `npm start`.

5- build and bundling your resources for production `yarn build`.

6- Unit testing will watch all your changes in the test files as well as create coverage folder for you.
`yarn test`

to browse locally

```
http://localhost:8080/
```

### android instruction
#### first time build
```
  npm run build
  npm install -g @ionic/cli
  npm install @capacitor/core --save
  ionic capacitor add android
  npx cap open android
```

#### rebuild
```
    - npm run build
    - npx cap copy android
    - npx cap update
    - npx cap open android
    - Android Studio--> sign app
    - Android Studio--> build apk
```

### run storybook

```
npm run storybook
```

to test components with storybook locally

```
http://localhost:6006/
```

## Development 
development requirements and tips and tools are described in this section.

### Application Version
there are three versions
1. version stored in server, served over nginx
1. version stored in client source file, stored in browser (or cached in browser)
1. version stored for data

#### Application 
whenever mismatch between server provided version and source file provided version detected, a force refresh gets the latest code.

#### Fail Safe Version Management
a bug in version detection leads to repeated force refreshes. so a mechanism for dealing with scenario is needed
this part is to be developed...
#### Data
the version is stored as "major.minor.buildnumber" and if major or/and minor numbers change, means data is incompatible with previous versions, so the app will delete all stored data.

Note that if data version change is required, 
  1. make sure to change either major or minor number in version, in .env.dev .env.stage and .env.prod files.
  1. also change nginx.dev.conf.yml and nginx.stage.conf.yml



### Adding Storybook
1. make sure the files are named in the *.stories.js format, as these files will be automatically detected by storybook and get built.
1. make sure appropriate title is set for each story. for adding folders in storybook, just use slash in the title for each folder. for instance, title set as ```a/b/c``` will be shown as 
   ```
   a
   |--b
      |-- c
   ```



### Adding Reducer
1.  make sure to add transform to store.transforms.js for complex data types
    
    because we are using redux-persist to store redux state in localStorage (or any other place if otherwise configured), for storing complex data types, such as Set or Map, we need to set a transformer which acts like SER/DES upon storing/restoring data. 
1. make sure to add reducer to store.js

### Adding Saga
1. make sure ``` sagaMiddleware.run(mySaga);``` is added store.js


## Technologies used

- [Webpack 4](https://github.com/webpack/webpack)
- [Babel 7](https://github.com/babel/babel) [ transforming JSX and ES6,ES7,ES8 ]
- [React](https://github.com/facebook/react) `16.8`
- [Lodash](https://github.com/lodash/lodash)
- [Jest](https://github.com/facebook/jest) [ Unit test]
- [Enzyme](http://airbnb.io/enzyme/) for UI testing.
- [Eslint](https://github.com/eslint/eslint/) with airbnb config
- [Prettier](https://github.com/prettier/prettier) [ Code formatter ]
- [Style](https://github.com/webpack-contrib/style-loader) & [CSS Loader](https://github.com/webpack-contrib/css-loader) & [SASS-loader](https://github.com/webpack-contrib/sass-loader)
- [CSS modules](https://github.com/css-modules/css-modules) [ Isolated style based on each component ]
- [Browsers list](https://github.com/browserslist/browserslist) [ Share target browsers between different front-end tools, like Autoprefixer, Stylelint and babel-preset-env ]
  [React Fast Refresh](https://github.com/pmmmwh/react-refresh-webpack-plugin)[For react hot module replacement]
- [Webpack dev serve](https://github.com/webpack/webpack-dev-server)
