package com.lqwd.security.oauth2.controller.admin;

import com.google.gson.Gson;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.google.gson.reflect.TypeToken;
import com.lqwd.security.oauth2.dto.LiquidityDTO;
import com.lqwd.security.oauth2.model.response.ApiResponse;
import com.lqwd.security.oauth2.model.response.DlaResponse;
import com.lqwd.security.oauth2.service.LiquidityService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;

import java.lang.reflect.Type;
import java.util.List;

@Controller
@RequiredArgsConstructor
public class LiquidityController {


    private final LiquidityService liquidityService;
    JsonParser parser = new JsonParser();


    @GetMapping("/backend/liquidity")
    public String grades(Model model, @RequestParam(defaultValue = "0",value = "pageNumber") int pageNumber,
                         @RequestParam(defaultValue = "10", value = "pageSize") int pageSize) throws Exception {

        DlaResponse response = liquidityService.getLiquidityRequests(pageNumber,pageSize);

        JsonObject res = parser.parse(response.getData()).getAsJsonObject();
        LiquidityDTO[] contents = new Gson().fromJson(res
                .get("data"),LiquidityDTO[].class );

        long total = res.get("count").getAsLong();
        int pages = (int)Math.ceil(total/pageSize);

        model.addAttribute("pageNo", res.get("pageNumber").getAsInt());
        model.addAttribute("pageSize", res.get("pageSize").getAsInt());
        model.addAttribute("total", total);
        model.addAttribute("pages", pages);
        model.addAttribute("content", contents);

        return "backend/liquiditylist";
    }


    @PostMapping( "/backend/create_channel")
    public ResponseEntity<ApiResponse<LiquidityDTO>> createNewAccountType(@RequestParam Long liquidityId) throws Exception {

        DlaResponse res =  liquidityService.openChannelForLiquidity(liquidityId);

        String message = res.getMessage();

        JsonObject response = null;

        if(res.getData() != null) {
            response = parser.parse(res.getData()).getAsJsonObject();
            message = response.get("message").getAsString();
        }

        if(res.getStatus() != 200)
            return new ResponseEntity<>(new ApiResponse<>
                    (res.getStatus(), null, message),

                    HttpStatus.valueOf(res.getStatus()));


        Type type = new TypeToken<ApiResponse<LiquidityDTO>>() {}.getType();

        ApiResponse<LiquidityDTO> contents = new Gson().fromJson(response,type);
        return new ResponseEntity<>(contents, HttpStatus.OK);



    }

}
