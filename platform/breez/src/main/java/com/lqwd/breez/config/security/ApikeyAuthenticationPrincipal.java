package com.lqwd.breez.config.security;

import java.security.Principal;

/**
 * Customg Authentication Principal Object
 *
 */
public class ApikeyAuthenticationPrincipal implements Principal {
    final String principalName="Breez-Admin";

    @Override
    public String getName() {
        return principalName;
    }
}
