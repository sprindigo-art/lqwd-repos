const webpack = require('webpack');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const ScriptExtHtmlWebpackPlugin = require('script-ext-html-webpack-plugin');
const ESLintPlugin = require('eslint-webpack-plugin');
const path = require('path');
const Dotenv = require('dotenv-webpack');
const commonPaths = require('./paths');

module.exports = {
    entry: commonPaths.entryPath,
    module: {
        rules: [{
                test: /\.(png|jpg|gif|svg)$/,
                exclude: [
                    path.resolve(__dirname, 'src/public')
                ],
                use: [{
                    loader: 'url-loader',
                    options: {
                        outputPath: commonPaths.imagesFolder,
                    },
                }, ],
            },
            {
                test: /\.(png|jpg|gif|svg)$/,
                include: [
                    path.resolve(__dirname, 'src/public')
                ],
                use: [{
                    loader: 'file-loader',
                    options: {
                        outputPath: commonPaths.publicFolder,
                    },
                }, ],
            },
            {
                test: /\.(woff2|ttf|woff|eot)$/,
                use: [{
                    loader: 'url-loader?limit=100000',
                    options: {
                        outputPath: commonPaths.fontsFolder,
                    },
                }, ],
            },
        ],
    },
    // serve: {
    //   add: app => {
    //     app.use(convert(history()));
    //   },
    //   content: commonPaths.entryPath,
    //   dev: {
    //     publicPath: commonPaths.outputPath,
    //   },
    //   open: true,
    // },
    resolve: {
        fallback: {
            buffer: require.resolve('buffer/'),
            crypto: require.resolve('crypto-browserify'),
            stream: require.resolve('stream-browserify'),
        },
        modules: ['src', 'node_modules'],
        extensions: ['*', '.js', '.jsx', '.css', '.scss'],
    },
    plugins: [
        new webpack.ProvidePlugin({
            Buffer: ['buffer', 'Buffer'],
        }),
        new webpack.ProvidePlugin({
            // Make a global `process` variable that points to the `process` package,
            // because the `util` package expects there to be a global variable named `process`.
            // Thanks to https://stackoverflow.com/a/65018686/14239942
            process: 'process/browser',
        }),
        new Dotenv(),
        new webpack.ProgressPlugin(),
        new HtmlWebpackPlugin({
            template: commonPaths.templatePath,
        }),
        new ScriptExtHtmlWebpackPlugin({
            defaultAttribute: 'async',
        }),
        new ESLintPlugin({
            extensions: ['js', 'jsx', 'ts', 'tsx'],
            fix: true,
            emitWarning: process.env.NODE_ENV !== 'production',
        }),
    ],
};