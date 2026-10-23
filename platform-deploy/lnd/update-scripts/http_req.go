package main

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io/ioutil"
	"log"
	"net/http"
	"net/url"
	"os"
	"strings"
)

type AccessToken struct {
	AccessToken string   `json:"access_token"`
	TokenType   string   `json:"token_type"`
	ExpiresIn   int      `json:"expires_in"`
	Roles       []string `json:"roles"`
}

type MacarronFiles struct {
	Data string `json:"data"`
}

func get_macarron_file(fileName string, nodeName string) string {
	client := &http.Client{}
	URL := "http://localhost:8790/" + "api/v1/decrypt"
	v := url.Values{}
	v.Set("requestType", "INTERNAL_FILE_NAME_AND_NODE")
	v.Set("fileName", fileName)
	v.Set("nodeName", nodeName)
	v.Set("password", "aziz72")

	bstr := []byte(`{"requestType":"INTERNAL_FILE_NAME_AND_NODE", "fileName":"admin.macaroon", "nodeName":"slnd-32669"}`)
	//pass the values to the request's body
	req, err := http.NewRequest("POST", URL, bytes.NewBuffer(bstr))
	req.Header.Add("Authorization", "Bearer "+get_access_token())
	req.Header.Add("Content-Type", "application/json")
	// req.Header.Add("Accept", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		log.Fatal(err)
	}
	bodyText, err := ioutil.ReadAll(resp.Body)
	// Unmarshal result
	mfile := MacarronFiles{}
	err = json.Unmarshal(bodyText, &mfile)
	if err != nil {
		log.Printf("Reading body failed: %s", err)

	}
	fmt.Println(mfile.Data)

	return mfile.Data
}

func decrypt_passphrase(enc_pass string) string {

	client := &http.Client{}
	URL := "http://localhost:8790/" + "api/v1/decrypt"
	v := url.Values{}
	v.Set("requestType", "EXTERNAL")
	v.Set("input", enc_pass)
	v.Set("method", "AEAD")
	v.Set("password", "aziz72")

	bstr := []byte(`{"requestType":"EXTERNAL", "input":` + enc_pass + `, "nodeName":"slnd-32669"}`)
	//pass the values to the request's body
	req, err := http.NewRequest("POST", URL, bytes.NewBuffer(bstr))
	req.Header.Add("Authorization", "Bearer "+get_access_token())
	req.Header.Add("Content-Type", "application/json")
	// req.Header.Add("Accept", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		log.Fatal(err)
	}
	bodyText, err := ioutil.ReadAll(resp.Body)
	// Unmarshal result
	dec_pass := MacarronFiles{}
	err = json.Unmarshal(bodyText, &dec_pass)
	if err != nil {
		log.Printf("Reading body failed: %s", err)

	}
	fmt.Println(dec_pass.Data)

	return dec_pass.Data
}

func save_to_file(file_name string, data string) {
	// Open a new file for writing only
	file, err := os.OpenFile(
		file_name,
		os.O_WRONLY|os.O_TRUNC|os.O_CREATE,
		0666,
	)
	if err != nil {
		log.Fatal(err)
	}
	defer file.Close()

	uDec, err := base64.URLEncoding.DecodeString(data)
	// Write bytes to file
	byteSlice := []byte(uDec)
	bytesWritten, err := file.Write(byteSlice)
	if err != nil {
		log.Fatal(err)
	}
	log.Printf("Wrote %d bytes.\n", bytesWritten)
}

func get_access_token() string {
	client := &http.Client{}
	URL := "http://localhost:8187/" + "oauth/token"
	v := url.Values{}
	v.Set("grant_type", "client_credentials")
	//pass the values to the request's body
	req, err := http.NewRequest("POST", URL, strings.NewReader(v.Encode()))
	req.SetBasicAuth("py-backend", "rude")
	req.Header.Add("Content-Type", "application/x-www-form-urlencoded")
	resp, err := client.Do(req)
	if err != nil {
		log.Fatal(err)
	}
	bodyText, err := ioutil.ReadAll(resp.Body)
	// Unmarshal result
	accessToken := AccessToken{}
	err = json.Unmarshal(bodyText, &accessToken)
	if err != nil {
		log.Printf("Reading body failed: %s", err)

	}
	fmt.Println(accessToken.Roles)

	// s := string(bodyText)
	return accessToken.AccessToken
}
