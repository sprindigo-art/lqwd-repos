---
name: x-post
description: Post to X (Twitter) using the local scripts in /opt/openclaw/workspace/x. This avoids xurl OAuth issues.
metadata:
  {
    "openclaw":
      {
        "emoji": "𝕏",
        "requires": { "bins": ["bash", "python3"] }
      }
  }
---

# x-post — Local X Posting

This workspace already contains a working X posting pipeline.

Use these scripts instead of attempting OAuth or using xurl.

Location:

/opt/openclaw/workspace/x/

## Primary script

Post content using:

bash /opt/openclaw/workspace/x/create_post_x.sh "TEXT"

Example:

bash /opt/openclaw/workspace/x/create_post_x.sh "Agent liquidity will define the future of Lightning."

## Logs

Posting logs can be viewed here:

/opt/openclaw/workspace/x/x_post.log

## Notes

• Do not expose tokens or credentials.  
• Tokens are stored locally in x_tokens.json.  
• If posting fails, inspect x_post.log.
