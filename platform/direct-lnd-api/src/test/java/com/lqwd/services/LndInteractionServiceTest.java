package com.lqwd.services;

import com.lqwd.AbstractTest;
import com.lqwd.model.entities.LndInteraction;
import com.lqwd.service.LndInteractionService;
import org.junit.Test;
import org.springframework.beans.factory.annotation.Autowired;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;

public class LndInteractionServiceTest extends AbstractTest {

    @Autowired
    private LndInteractionService lndInteractionService;


    @Test
    public void createInteractionTest()  {

        LndInteraction interaction = LndInteraction.builder().action("v1/test").nodeName("lnd4")
                .request("test").response("{\"test\":\"test\"}").build();

        interaction = lndInteractionService.logLndInteraction(interaction);

        assertEquals("lnd4",interaction.getNodeName());
        assertNotNull(interaction.getId());

        lndInteractionService.delete(interaction.getId());

    }




}