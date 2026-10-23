package com.lqwd.security.oauth2.controller.admin;

import com.google.gson.Gson;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.lqwd.security.oauth2.dto.StakingDTO;
import com.lqwd.security.oauth2.model.response.DlaResponse;
import com.lqwd.security.oauth2.service.StakingService;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;

@Controller
@RequiredArgsConstructor
public class StakingController {


    private final StakingService stakingService;
    JsonParser parser = new JsonParser();


    @GetMapping("/backend/staking/find_all")
    public String grades(Model model, @RequestParam(defaultValue = "0",value = "pageNumber") int pageNumber,
                         @RequestParam(defaultValue = "10", value = "pageSize") int pageSize) throws Exception {

        DlaResponse response = stakingService.getStakingList(pageNumber,pageSize);

        JsonObject res = parser.parse(response.getData()).getAsJsonObject();

        StakingDTO[] contents = new Gson().fromJson(res
                .get("data"),StakingDTO[].class );

        long total = res.get("count").getAsLong();
        int pages = (int)Math.ceil(total/pageSize);

        model.addAttribute("pageNo", res.get("pageNumber").getAsInt());
        model.addAttribute("pageSize", res.get("pageSize").getAsInt());
        model.addAttribute("total", total);
        model.addAttribute("pages", pages);
        model.addAttribute("content", contents);

        return "backend/stakinglist";
    }


}
