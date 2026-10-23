#!/bin/bash

# Source Moltbook environment variables
source "/opt/openclaw/workspace/moltbook/moltbook_env.sh"

# Rest of the script remains the same

# Check if jq is installed
if ! command -v jq &> /dev/null; then
    echo "Error: jq is not installed. Please install jq to use this script."
    exit 1
fi

# Maximum number of retries (1 retry after the initial attempt)
MAX_RETRIES=1
DEFAULT_RETRY_DELAY_SECONDS=15 # Default wait time if API doesn't specify

# Loop for retries
for ((i=0; i<=MAX_RETRIES; i++)); do
    # Construct JSON payload conditionally including URL
    # Start building the base payload with required fields
    JSON_PAYLOAD=$(jq -n \
        --arg subm "$SUBMOLT" \
        --arg title "$TITLE" \
        --arg content "$CONTENT" \
        --arg type "$TYPE" \
        '{submolt: $subm, title: $title, content: $content, type: $type}')

    # Conditionally add the URL field if it's not empty
    if [ -n "$URL" ]; then
        JSON_PAYLOAD=$(echo "$JSON_PAYLOAD" | jq --arg url "$URL" '.url = $url')
    fi

    # Post to Moltbook API
    echo "Attempt $((i+1))/$((MAX_RETRIES+1)) to post to Moltbook API at $MOLTBOOK_API_BASE/posts..."
    echo "Payload: $JSON_PAYLOAD"

    RESPONSE=$(curl -s -X POST \
        -H "Authorization: Bearer $MOLTBOOK_API_KEY" \
        -H "Content-Type: application/json" \
        -d "$JSON_PAYLOAD" \
        "$MOLTBOOK_API_BASE/posts")

    echo "Response: $RESPONSE"

    # Check if the post was successful (response contains an 'id' field)
    if echo "$RESPONSE" | jq -e '.id' > /dev/null; then
        echo "Post successful."
        exit 0 # Exit script on success
    else
        echo "Post failed on attempt $((i+1))."
        
        # Check if it's a rate limiting error (429) and extract dynamic delay
        STATUS_CODE=$(echo "$RESPONSE" | jq -r '.statusCode')
        RETRY_AFTER=$(echo "$RESPONSE" | jq -r '.retry_after_seconds')

        # If it's a 429 error and retry_after_seconds is a valid positive number
        if [ "$STATUS_CODE" = "429" ] && [[ "$RETRY_AFTER" =~ ^[0-9]+$ ]] && [ "$RETRY_AFTER" -gt 0 ]; then
            SLEEP_DURATION=$RETRY_AFTER
            echo "Rate limit detected. Retrying in $SLEEP_DURATION seconds..."
        else
            # Fallback to default delay for other errors or if retry_after_seconds is invalid
            SLEEP_DURATION=$DEFAULT_RETRY_DELAY_SECONDS
            echo "Encountered non-rate-limiting error or invalid retry delay. Retrying in $SLEEP_DURATION seconds..."
        fi

        # If it's not the last attempt, wait and retry
        if [ $i -lt $MAX_RETRIES ]; then
            sleep $SLEEP_DURATION
        fi
    fi
done

# If the loop finishes without success, report final failure
echo "Final failure: Post could not be completed after $((MAX_RETRIES+1)) attempts."
exit 1
